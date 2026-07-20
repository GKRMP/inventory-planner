import { resolveAdminAndShop } from "../services/cron-auth.server";
import { runHealthChecks, findOrphanedProducts } from "../services/health.server";

// GET /api/health?shop=xxx.myshopify.com
//   Asserts the invariants that keep the Postgres mirror in step with
//   Shopify. Returns 200 when all pass and 503 when any fail, so a scheduled
//   caller (Render Cron Job, uptime monitor) alerts on the non-2xx without
//   needing to parse the body.
//
//   Same auth as /api/sync: x-sync-secret header, or an embedded admin session.
//
//   Query params:
//     maxAgeHours=48  — how stale lastFullSyncAt may be before failing
//     orphans=1       — additionally list which mirror products no longer
//                       exist in Shopify (costs an extra API call; the plain
//                       check only reports the count)
//
// Read-only by design: it never registers webhooks or starts a sync, so it's
// safe to poll on a schedule. To make webhook registration self-healing after
// an app rebuild, point a separate scheduled call at POST /api/setup-webhook —
// that endpoint is idempotent and creates only what's missing.
export async function loader({ request }) {
  const { admin, shop } = await resolveAdminAndShop(request);
  const url = new URL(request.url);

  const parsedMaxAge = parseFloat(url.searchParams.get("maxAgeHours"));
  const maxSyncAgeHours = Number.isFinite(parsedMaxAge) && parsedMaxAge > 0 ? parsedMaxAge : undefined;

  try {
    const result = await runHealthChecks(admin, shop, { maxSyncAgeHours });

    if (url.searchParams.get("orphans") === "1") {
      const orphans = await findOrphanedProducts(admin, shop);
      result.orphanedProducts = orphans;
    }

    // 503 rather than 500: the app is up, the data pipeline is not.
    return Response.json(result, { status: result.ok ? 200 : 503 });
  } catch (error) {
    console.error(`Health check error for ${shop}:`, error);
    return Response.json(
      { shop, ok: false, error: error.message || "Health check failed" },
      { status: 500 }
    );
  }
}
