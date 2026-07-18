import prisma from "../db.server";
import { adjustInventoryQuantity } from "./inventory.server";

// A cycle count session snapshots expectedQty from the mirror at creation
// time — later mirror drift (a sale, a webhook) doesn't retroactively change
// what the session is checking against.
export async function createSession(shop, { name, binLocation = "", search = "" } = {}) {
  const trimmedBin = binLocation.trim();
  const trimmedSearch = search.trim();

  const variants = await prisma.variant.findMany({
    where: {
      shop,
      ...(trimmedBin ? { binLocation: { equals: trimmedBin, mode: "insensitive" } } : {}),
      ...(trimmedSearch
        ? {
            OR: [
              { sku: { contains: trimmedSearch, mode: "insensitive" } },
              { title: { contains: trimmedSearch, mode: "insensitive" } },
            ],
          }
        : {}),
    },
  });

  if (!variants.length) return { error: "No parts matched that bin/search filter" };

  const session = await prisma.cycleCountSession.create({
    data: {
      shop,
      name: name || trimmedBin || trimmedSearch || "Cycle count",
      items: {
        create: variants.map((v) => ({ variantId: v.id, expectedQty: v.inventoryQuantity })),
      },
    },
    include: { items: true },
  });

  return { ok: true, session };
}

export async function listSessions(shop) {
  const sessions = await prisma.cycleCountSession.findMany({
    where: { shop },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });

  return sessions.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    createdAt: s.createdAt,
    closedAt: s.closedAt,
    itemCount: s.items.length,
    countedCount: s.items.filter((i) => i.countedQty !== null).length,
    discrepancyCount: s.items.filter((i) => i.countedQty !== null && i.countedQty !== i.expectedQty).length,
  }));
}

export async function getSession(shop, id) {
  const session = await prisma.cycleCountSession.findFirst({
    where: { id, shop },
    include: { items: { include: { variant: { include: { product: true } } } } },
  });
  if (!session) return null;

  return {
    ...session,
    items: session.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      expectedQty: item.expectedQty,
      countedQty: item.countedQty,
      verifiedAt: item.verifiedAt,
      note: item.note,
      sku: item.variant.sku,
      variantTitle: item.variant.title,
      productTitle: item.variant.product?.title || "Unknown",
      binLocation: item.variant.binLocation,
      inventoryItemId: item.variant.inventoryItemId,
    })),
  };
}

export async function recordCount(shop, itemId, { countedQty, note }) {
  const item = await prisma.cycleCountItem.findFirst({
    where: { id: itemId, session: { shop } },
  });
  if (!item) return { error: "Item not found" };

  const updated = await prisma.cycleCountItem.update({
    where: { id: itemId },
    data: {
      countedQty: Math.max(0, Math.trunc(countedQty) || 0),
      note: note ?? item.note,
      verifiedAt: new Date(),
    },
  });
  return { ok: true, item: updated };
}

// Closes a session. If applyCorrections is set, every counted item whose
// countedQty differs from expectedQty gets a real inventory adjustment
// (reusing the same helper PO receiving uses) before the mirror is updated.
export async function closeSession(shop, id, { admin, applyCorrections } = {}) {
  const session = await getSession(shop, id);
  if (!session) return { error: "Session not found" };
  if (session.status === "CLOSED") return { error: "Session is already closed" };

  const corrections = [];
  if (applyCorrections) {
    const syncState = await prisma.syncState.findUnique({ where: { shop } });
    for (const item of session.items) {
      if (item.countedQty === null || item.countedQty === item.expectedQty) continue;
      const delta = item.countedQty - item.expectedQty;

      if (!item.inventoryItemId || !syncState?.locationId) {
        corrections.push({ itemId: item.id, sku: item.sku, error: "Missing inventory item or location" });
        continue;
      }

      const adjustment = await adjustInventoryQuantity(admin, {
        inventoryItemId: item.inventoryItemId,
        locationId: syncState.locationId,
        delta,
        reason: "cycle_count_available",
        referenceDocumentUri: `gid://rmp-inventory-planner/CycleCountSession/${id}`,
      });

      if (adjustment.error) {
        corrections.push({ itemId: item.id, sku: item.sku, error: adjustment.error });
        continue;
      }

      await prisma.variant.update({ where: { id: item.variantId }, data: { inventoryQuantity: item.countedQty } });
      corrections.push({ itemId: item.id, sku: item.sku, delta, ok: true });
    }
  }

  await prisma.cycleCountSession.update({
    where: { id },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  return { ok: true, corrections };
}
