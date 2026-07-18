// Shared low-level inventory adjustment, used by PO receiving
// (purchase-orders.server.js) and cycle-count corrections
// (cycle-counts.server.js) — one place that knows the inventoryAdjustQuantities
// shape so both callers can't drift on reason strings or the mutation itself.
export async function adjustInventoryQuantity(admin, { inventoryItemId, locationId, delta, reason, referenceDocumentUri }) {
  const response = await admin.graphql(
    `
      mutation AdjustInventoryQuantity($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        input: {
          name: "available",
          reason,
          referenceDocumentUri,
          changes: [{ delta, inventoryItemId, locationId }],
        },
      },
    }
  );
  const result = await response.json();
  const userErrors = result?.data?.inventoryAdjustQuantities?.userErrors || [];
  if (userErrors.length) return { error: userErrors.map((e) => e.message).join("; ") };
  return { ok: true };
}
