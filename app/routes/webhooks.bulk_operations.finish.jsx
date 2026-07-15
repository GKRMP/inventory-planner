import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { completeBulkSync } from "../services/sync.server";
import { startOrdersBulkSync, completeOrdersBulkSync, recomputeVelocities } from "../services/demand.server";

// Fires when a bulkOperationRunQuery completes (success or failure). Only one
// bulk operation may run per shop at a time, and this webhook doesn't say
// which query it was — SyncState.bulkOperationType (set when the op was
// started) tells us whether to run the catalog or the orders completion
// handler. completeBulkSync/completeOrdersBulkSync each re-query
// currentBulkOperation for the result url/status; the webhook payload is
// just the trigger.
//
// Chain: catalog completes → kick off the orders backfill (self-heals any
// webhook drift) → orders completes → recomputeVelocities. A shop with no
// orders scope yet simply never advances past the catalog step.
export const action = async ({ request }) => {
  const { shop, payload, topic, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin) {
    console.error(`No offline session for ${shop}; skipping bulk sync completion`);
    return new Response();
  }

  try {
    const syncState = await prisma.syncState.findUnique({ where: { shop } });
    const bulkType = syncState?.bulkOperationType || "catalog";

    if (bulkType === "orders") {
      const result = await completeOrdersBulkSync(admin, shop);
      if (!result.ok) {
        console.error(`Orders bulk sync did not complete cleanly for ${shop}:`, result.reason);
      } else {
        await recomputeVelocities(shop);
      }
      return new Response();
    }

    const result = await completeBulkSync(admin, shop);
    if (!result.ok) {
      console.error(`Bulk sync did not complete cleanly for ${shop}:`, result.reason);
      return new Response();
    }

    try {
      await startOrdersBulkSync(admin, shop);
    } catch (error) {
      console.error(`Failed to start orders backfill for ${shop}:`, error);
    }
  } catch (error) {
    console.error(`Failed to complete bulk sync for ${shop}:`, error, payload);
  }

  return new Response();
};
