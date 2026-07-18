import { authenticate } from "../shopify.server";
import { saveDraftPOs } from "../services/purchase-orders.server";

// POST /api/purchase-orders
// Body: { supplierGroups: [{ supplierId, items: [{variantId, sku, mpn, qty, unitCost}] }] }
// Backs the dashboard's "Save draft" action — replaces each supplier's open
// DRAFT purchase order with the drawer's current line items.
export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const body = await request.json();

  const supplierGroups = body.supplierGroups || [];
  if (!Array.isArray(supplierGroups) || !supplierGroups.length) {
    return Response.json({ error: "supplierGroups is required" }, { status: 400 });
  }

  const purchaseOrders = await saveDraftPOs(session.shop, supplierGroups);
  return Response.json({ purchaseOrders });
}
