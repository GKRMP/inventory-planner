import prisma from "../db.server";
import { writeThroughSupplierData } from "./sync.server";

// Purchase orders are Postgres-native (no Shopify metaobject mirror) — the
// only Shopify-side effect is the inventory adjustment + supplier_data
// last-order fields written back when a line is received.

const TRANSITIONS = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["CANCELLED"],
  PARTIAL: ["CANCELLED"],
};

function toLineData(item) {
  return {
    variantId: item.variantId,
    sku: item.sku || null,
    mpn: item.mpn || null,
    qtyOrdered: Math.max(1, Math.trunc(item.qty) || 1),
    unitCost: Number(item.unitCost) || 0,
  };
}

async function createPO(shop, supplierId, items) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await prisma.purchaseOrder.count({ where: { shop } });
    try {
      return await prisma.purchaseOrder.create({
        data: {
          shop,
          supplierId,
          number: count + 1 + attempt,
          lineItems: { create: items.map(toLineData) },
        },
        include: { lineItems: true },
      });
    } catch (error) {
      // Unique [shop, number] collision from a concurrent create — retry with the next number.
      if (error.code === "P2002") continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a purchase order number after several attempts");
}

// Upserts one DRAFT purchase order per supplier group. Called by the
// dashboard's "Save draft" action — re-saving replaces the DRAFT PO's line
// items wholesale so the drawer's current state is always the source of truth.
export async function saveDraftPOs(shop, supplierGroups) {
  const results = [];
  for (const group of supplierGroups) {
    if (!group.supplierId || !group.items?.length) continue;

    const existing = await prisma.purchaseOrder.findFirst({
      where: { shop, supplierId: group.supplierId, status: "DRAFT" },
    });

    if (existing) {
      await prisma.pOLineItem.deleteMany({ where: { purchaseOrderId: existing.id } });
      const updated = await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: { lineItems: { create: group.items.map(toLineData) } },
        include: { lineItems: true },
      });
      results.push(updated);
    } else {
      results.push(await createPO(shop, group.supplierId, group.items));
    }
  }
  return results;
}

// Flat seed for the dashboard drawer: variantId -> {supId, qty} for every
// line item across the shop's open DRAFT purchase orders, so a draft built
// on one tab/session survives a reload.
export async function getDraftPOSeed(shop) {
  const drafts = await prisma.purchaseOrder.findMany({
    where: { shop, status: "DRAFT" },
    include: { lineItems: true },
  });

  const seed = {};
  for (const po of drafts) {
    for (const line of po.lineItems) {
      seed[line.variantId] = { supId: po.supplierId, qty: line.qtyOrdered };
    }
  }
  return seed;
}

function withTotals(po) {
  const totalQty = po.lineItems.reduce((s, l) => s + l.qtyOrdered, 0);
  const totalCost = po.lineItems.reduce((s, l) => s + l.qtyOrdered * l.unitCost, 0);
  return { ...po, itemCount: po.lineItems.length, totalQty, totalCost };
}

export async function listPurchaseOrders(shop, { status } = {}) {
  const pos = await prisma.purchaseOrder.findMany({
    where: { shop, ...(status && status !== "all" ? { status: status.toUpperCase() } : {}) },
    include: { lineItems: true },
    orderBy: { createdAt: "desc" },
  });

  const supplierIds = [...new Set(pos.map((p) => p.supplierId))];
  const suppliers = await prisma.supplier.findMany({ where: { shop, supplierId: { in: supplierIds } } });
  const supplierName = Object.fromEntries(suppliers.map((s) => [s.supplierId, s.name]));

  return pos.map((po) => ({ ...withTotals(po), supplierName: supplierName[po.supplierId] || po.supplierId }));
}

export async function getPurchaseOrder(shop, id) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, shop },
    include: { lineItems: { orderBy: { createdAt: "asc" } } },
  });
  if (!po) return null;

  const [supplier, variants] = await Promise.all([
    prisma.supplier.findFirst({ where: { shop, supplierId: po.supplierId } }),
    prisma.variant.findMany({
      where: { id: { in: po.lineItems.map((l) => l.variantId) } },
      include: { product: true },
    }),
  ]);
  const variantById = Object.fromEntries(variants.map((v) => [v.id, v]));

  return {
    ...withTotals(po),
    supplierName: supplier?.name || po.supplierId,
    lineItems: po.lineItems.map((l) => ({
      ...l,
      productTitle: variantById[l.variantId]?.product?.title || null,
      variantTitle: variantById[l.variantId]?.title || null,
    })),
  };
}

export async function updateStatus(shop, id, nextStatus) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, shop } });
  if (!po) return { error: "Purchase order not found" };
  if (!TRANSITIONS[po.status]?.includes(nextStatus)) {
    return { error: `Cannot move a ${po.status} purchase order to ${nextStatus}` };
  }

  const data = { status: nextStatus };
  if (nextStatus === "SENT") data.sentAt = new Date();

  return { ok: true, po: await prisma.purchaseOrder.update({ where: { id }, data }) };
}

async function recomputePOStatus(purchaseOrderId) {
  const lines = await prisma.pOLineItem.findMany({ where: { purchaseOrderId } });
  const allReceived = lines.every((l) => l.qtyReceived >= l.qtyOrdered);
  const anyReceived = lines.some((l) => l.qtyReceived > 0);

  if (allReceived) {
    await prisma.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: "RECEIVED", receivedAt: new Date() },
    });
  } else if (anyReceived) {
    await prisma.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: "PARTIAL" } });
  }
}

// Writes the receiving event back onto the variant's supplier_data metafield
// (last_order_date/cpu/quantity), matching the shape api.variant-supplier.js
// writes. Best-effort — the inventory adjustment is the transaction that
// matters; a failed metafield write here is logged and healed by the next
// full sync, same as any other mirror write.
async function recordReceiptOnSupplierData(admin, shop, line, supplierId, qty) {
  try {
    const variant = await prisma.variant.findUnique({ where: { id: line.variantId } });
    const raw = variant?.supplierDataRaw;
    const sources = Array.isArray(raw) ? raw.slice() : raw ? [raw] : [];
    const idx = sources.findIndex((s) => s.supplier_id === supplierId);
    const today = new Date().toISOString().slice(0, 10);
    const receipt = {
      last_order_date: today,
      last_order_cpu: line.unitCost,
      last_order_quantity: qty,
    };

    if (idx >= 0) {
      sources[idx] = { ...sources[idx], ...receipt };
    } else {
      sources.push({ supplier_id: supplierId, mpn: line.mpn || "", is_primary: sources.length === 0, ...receipt });
    }

    const value = JSON.stringify(sources);
    const response = await admin.graphql(
      `
        mutation SetSupplierDataOnReceive($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          metafields: [
            { ownerId: line.variantId, namespace: "inventory", key: "supplier_data", type: "json", value },
          ],
        },
      }
    );
    const result = await response.json();
    const userErrors = result?.data?.metafieldsSet?.userErrors || [];
    if (userErrors.length) {
      console.error(`supplier_data receipt write failed for ${line.variantId}:`, userErrors);
      return;
    }
    await writeThroughSupplierData(shop, line.variantId, value);
  } catch (error) {
    console.error(`recordReceiptOnSupplierData failed for ${line.variantId}:`, error);
  }
}

// Receives a quantity against one PO line: adjusts real Shopify inventory,
// then advances qtyReceived and the parent PO's status. Idempotent — clamps
// the requested qty to what's still outstanding so a duplicate/retried call
// can't double-adjust inventory.
export async function receiveLine(shop, { admin, lineItemId, qty }) {
  const line = await prisma.pOLineItem.findFirst({
    where: { id: lineItemId, purchaseOrder: { shop } },
    include: { purchaseOrder: true },
  });
  if (!line) return { error: "Line item not found" };
  if (line.purchaseOrder.status === "CANCELLED") return { error: "Purchase order is cancelled" };
  if (line.purchaseOrder.status === "DRAFT") return { error: "Send the purchase order before receiving" };

  const remaining = line.qtyOrdered - line.qtyReceived;
  const receiveQty = Math.min(Math.max(0, Math.trunc(qty) || 0), remaining);
  if (receiveQty <= 0) {
    return { error: remaining <= 0 ? "Line is already fully received" : "Quantity must be greater than 0" };
  }

  const [variant, syncState] = await Promise.all([
    prisma.variant.findUnique({ where: { id: line.variantId } }),
    prisma.syncState.findUnique({ where: { shop } }),
  ]);
  if (!variant?.inventoryItemId) return { error: "Variant is missing its inventory item id — run a sync first" };
  if (!syncState?.locationId) return { error: "No location on file yet — run a sync first" };

  const response = await admin.graphql(
    `
      mutation ReceivePOLine($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        input: {
          name: "available",
          reason: "received",
          referenceDocumentUri: `gid://rmp-inventory-planner/PurchaseOrder/${line.purchaseOrderId}`,
          changes: [
            { delta: receiveQty, inventoryItemId: variant.inventoryItemId, locationId: syncState.locationId },
          ],
        },
      },
    }
  );
  const result = await response.json();
  const userErrors = result?.data?.inventoryAdjustQuantities?.userErrors || [];
  if (userErrors.length) return { error: userErrors.map((e) => e.message).join("; ") };

  await recordReceiptOnSupplierData(admin, shop, line, line.purchaseOrder.supplierId, receiveQty);

  const updatedLine = await prisma.pOLineItem.update({
    where: { id: lineItemId },
    data: { qtyReceived: { increment: receiveQty } },
  });
  await recomputePOStatus(line.purchaseOrderId);

  return { ok: true, line: updatedLine, received: receiveQty };
}
