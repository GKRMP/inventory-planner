import { authenticate } from "../shopify.server";
import { completeBulkSync } from "../services/sync.server";

// Fires when a bulkOperationRunQuery completes (success or failure).
// completeBulkSync re-queries currentBulkOperation itself for the result
// url/status — the webhook payload is just the trigger.
export const action = async ({ request }) => {
  const { shop, payload, topic, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (!admin) {
    console.error(`No offline session for ${shop}; skipping bulk sync completion`);
    return new Response();
  }

  try {
    const result = await completeBulkSync(admin, shop);
    if (!result.ok) {
      console.error(`Bulk sync did not complete cleanly for ${shop}:`, result.reason);
    }
  } catch (error) {
    console.error(`Failed to complete bulk sync for ${shop}:`, error, payload);
  }

  return new Response();
};
