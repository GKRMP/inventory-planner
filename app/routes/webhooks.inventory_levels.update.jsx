import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// NOTE: single-location assumption. `available` in this payload is the
// on-hand count at one location; we mirror it as the variant's total
// inventoryQuantity. Correct for a single-location shop (Roberts Motor
// Parts today); multi-location support needs summing across locations and
// is out of scope until Phase 4 introduces per-location tracking.
export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const inventoryItemId = `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
    const available = typeof payload.available === "number" ? payload.available : null;
    if (available !== null) {
      await prisma.variant.updateMany({
        where: { shop, inventoryItemId },
        data: { inventoryQuantity: available },
      });
    }
  } catch (error) {
    console.error(`Failed to mirror ${topic} webhook for ${shop}:`, error);
  }

  return new Response();
};
