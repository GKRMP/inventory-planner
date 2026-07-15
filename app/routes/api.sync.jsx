import { startBulkSync, completeBulkSync } from "../services/sync.server";
import { startOrdersBulkSync, completeOrdersBulkSync, recomputeVelocities } from "../services/demand.server";
import { getSyncStatus } from "../services/catalog-queries.server";
import { resolveAdminAndShop } from "../services/cron-auth.server";

// GET /api/sync?shop=xxx.myshopify.com&intent=status — cheap health check
// (row counts + last sync state) without needing database shell access.
// Same auth rules as the POST action: x-sync-secret header, or embedded
// admin session.
export async function loader({ request }) {
  const { shop } = await resolveAdminAndShop(request);

  try {
    const status = await getSyncStatus(shop);
    return Response.json(status);
  } catch (error) {
    console.error(`Sync status error for ${shop}:`, error);
    return Response.json({ error: error.message || "Failed to load sync status" }, { status: 500 });
  }
}

export async function action({ request }) {
  const { admin, shop } = await resolveAdminAndShop(request);
  const url = new URL(request.url);
  const intent = url.searchParams.get("intent") || "start";

  try {
    if (intent === "complete") {
      const result = await completeBulkSync(admin, shop);
      return Response.json(result);
    }

    // Manual/testing entry points for the orders half of the sync — normally
    // reached automatically via the bulk_operations/finish webhook chain
    // (catalog completes → orders backfill starts → orders completes →
    // recomputeVelocities), so these aren't needed by the nightly cron.
    if (intent === "start-orders") {
      const result = await startOrdersBulkSync(admin, shop);
      return Response.json(result);
    }
    if (intent === "complete-orders") {
      const result = await completeOrdersBulkSync(admin, shop);
      return Response.json(result);
    }
    if (intent === "recompute-velocities") {
      await recomputeVelocities(shop);
      return Response.json({ ok: true });
    }

    const result = await startBulkSync(admin, shop);
    return Response.json(result);
  } catch (error) {
    console.error(`Sync ${intent} error for ${shop}:`, error);
    return Response.json({ error: error.message || "Sync failed" }, { status: 500 });
  }
}
