import prisma from "../db.server";
import { getSyncStatus } from "./catalog-queries.server";
import { fetchRegisteredWebhooks, diffExpectedWebhooks } from "./webhook-registry.server";

// Asserts the invariants that, when broken, cause the mirror to silently
// drift from Shopify. Every failure mode here has actually happened:
//
//   - 2026-07-15: the app was rebuilt under a new client_id, which starts
//     with zero webhook subscriptions. bulk_operations/finish never fired, so
//     completeBulkSync never ran, so Variant.inventoryQuantity froze. The
//     nightly cron kept starting bulk operations that never landed. Nothing
//     surfaced it for five days — it was found only because a human noticed
//     one part's on-hand looked wrong.
//
// The point of this module is that the *next* occurrence is loud. A stale
// lastFullSyncAt is the single highest-signal indicator: it goes stale
// whichever way the sync breaks (missing webhook, misrouted completion, bulk
// op failure), so alert on it even if every other check passes.

const DEFAULT_MAX_SYNC_AGE_HOURS = 48;

function hoursSince(date) {
  if (!date) return null;
  return (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60);
}

// Shopify returns count with a precision flag; only EXACT is safe to compare
// against the mirror, since AT_LEAST means the real total is higher and would
// produce a phantom orphan count.
async function fetchShopifyProductCount(admin) {
  const response = await admin.graphql(`{ productsCount { count precision } }`);
  const data = await response.json();
  const result = data.data?.productsCount;
  if (!result || result.precision !== "EXACT") return null;
  return result.count;
}

export async function runHealthChecks(admin, shop, { maxSyncAgeHours = DEFAULT_MAX_SYNC_AGE_HOURS } = {}) {
  const status = await getSyncStatus(shop);
  const checks = [];

  // 1. Catalog reconcile is running. This is the check that would have caught
  // the 2026-07-15 outage on day one instead of day five.
  const syncAge = hoursSince(status.lastFullSyncAt);
  checks.push({
    name: "catalog_sync_recent",
    ok: syncAge !== null && syncAge <= maxSyncAgeHours,
    detail:
      syncAge === null
        ? "No full catalog sync has ever completed"
        : `Last full sync ${syncAge.toFixed(1)}h ago (threshold ${maxSyncAgeHours}h)`,
    lastFullSyncAt: status.lastFullSyncAt,
  });

  // 2. No sticky error left on SyncState. completeBulkSync/completeOrdersBulkSync
  // record failures here and only a successful start clears it.
  checks.push({
    name: "sync_error_clear",
    ok: !status.error,
    detail: status.error || "No error recorded",
  });

  // 3. Every webhook this app depends on is registered against the current
  // app URL. Catches an app rebuild, a reinstall, or a changed SHOPIFY_APP_URL.
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) {
    checks.push({
      name: "webhooks_registered",
      ok: false,
      detail: "SHOPIFY_APP_URL is not set — cannot verify webhook subscriptions",
    });
  } else {
    try {
      const registered = await fetchRegisteredWebhooks(admin);
      const diff = diffExpectedWebhooks(appUrl, registered);
      const missing = diff.filter((d) => !d.registered).map((d) => d.topic);
      checks.push({
        name: "webhooks_registered",
        ok: missing.length === 0,
        detail: missing.length ? `Missing subscriptions: ${missing.join(", ")}` : "All subscriptions registered",
        missing,
      });
    } catch (error) {
      checks.push({
        name: "webhooks_registered",
        ok: false,
        detail: `Webhook check failed: ${error.message}`,
      });
    }
  }

  // 4. Orphan detection. The bulk sync only ever upserts — it never prunes, so
  // products deleted in Shopify while products/delete was unregistered stay in
  // the mirror forever as phantom parts with frozen quantities. No sync will
  // clear them; they need an explicit cleanup.
  try {
    const shopifyProductCount = await fetchShopifyProductCount(admin);
    if (shopifyProductCount === null) {
      checks.push({
        name: "no_orphaned_products",
        ok: true,
        detail: "Skipped — Shopify did not report an exact product count",
      });
    } else {
      const orphans = status.productCount - shopifyProductCount;
      checks.push({
        name: "no_orphaned_products",
        ok: orphans <= 0,
        detail:
          orphans > 0
            ? `Mirror has ${orphans} more product(s) than Shopify — likely deletes missed while webhooks were down`
            : "Mirror product count is consistent with Shopify",
        mirrorProductCount: status.productCount,
        shopifyProductCount,
      });
    }
  } catch (error) {
    checks.push({
      name: "no_orphaned_products",
      ok: false,
      detail: `Orphan check failed: ${error.message}`,
    });
  }

  return {
    shop,
    ok: checks.every((c) => c.ok),
    checkedAt: new Date().toISOString(),
    checks,
    status,
  };
}

// Lists mirror products that no longer exist in Shopify, by checking the
// mirror's ids against Shopify in batches. Separate from runHealthChecks
// because it costs one API call per 250 products — the health check only
// reports *that* orphans exist; this identifies *which*.
export async function findOrphanedProducts(admin, shop, { limit = 250 } = {}) {
  const mirrored = await prisma.product.findMany({
    where: { shop },
    select: { id: true, title: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  if (!mirrored.length) return [];

  const response = await admin.graphql(
    `query CheckProducts($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id } } }`,
    { variables: { ids: mirrored.map((p) => p.id) } }
  );
  const data = await response.json();
  const alive = new Set((data.data?.nodes || []).filter(Boolean).map((n) => n.id));

  return mirrored.filter((p) => !alive.has(p.id));
}
