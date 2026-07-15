import prisma from "../db.server";
import { authenticate } from "../shopify.server";

// Reconstructs the metaobject-fields shape ({id, handle, fields: [{key, value}]})
// that app.dashboard.jsx's supMap builder and every other consumer already
// expect, so switching suppliers from a live metaobjects query to this mirror
// requires no changes to that client-side logic.
function supplierToMetaobjectShape(s) {
  const kv = (key, value) => ({ key, value: value ?? "" });
  return {
    id: s.id,
    handle: s.id,
    fields: [
      kv("supplier_id", s.supplierId),
      kv("supplier_name", s.name),
      kv("contact_name", s.contactName),
      kv("contact_name_2", s.contactName2),
      kv("address", s.address),
      kv("address_2", s.address2),
      kv("city", s.city),
      kv("state", s.state),
      kv("zip", s.zip),
      kv("country", s.country),
      kv("phone_1", s.phone1),
      kv("phone_2", s.phone2),
      kv("email_1", s.email1),
      kv("email_2", s.email2),
      kv("website", s.website),
      kv("notes", s.notes),
      kv("specialized_mfg", s.specializedMfg ? "true" : "false"),
    ],
  };
}

export async function getSuppliers(shop) {
  const suppliers = await prisma.supplier.findMany({
    where: { shop },
    orderBy: { name: "asc" },
  });
  return suppliers.map(supplierToMetaobjectShape);
}

// Reconstructs the variant shape enrichVariant/getSupplierData already
// expect: {id, sku, variantTitle, productTitle, productStatus,
// inventoryQuantity, metafields}, synthesizing a single "supplier_data"
// metafield from the mirrored JSON column.
function variantToShape(v) {
  return {
    id: v.id,
    sku: v.sku || "",
    variantTitle: v.title || "",
    productTitle: v.product?.title || "Unknown",
    productStatus: v.product?.status || "ACTIVE",
    inventoryQuantity: v.inventoryQuantity || 0,
    metafields: v.supplierDataRaw
      ? [
          {
            id: `${v.id}-supplier_data`,
            namespace: "inventory",
            key: "supplier_data",
            value: JSON.stringify(v.supplierDataRaw),
          },
        ]
      : [],
  };
}

export async function getVariantsWithSources(shop, { search = "", supplierId = "all", status = "ACTIVE" } = {}) {
  const trimmedSearch = search.trim();

  const where = {
    shop,
    ...(status ? { product: { status } } : {}),
    ...(trimmedSearch
      ? {
          OR: [
            { sku: { contains: trimmedSearch, mode: "insensitive" } },
            { title: { contains: trimmedSearch, mode: "insensitive" } },
            { product: { title: { contains: trimmedSearch, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(supplierId && supplierId !== "all" ? { sources: { some: { supplierId } } } : {}),
  };

  const variants = await prisma.variant.findMany({
    where,
    include: { product: true },
    orderBy: { sku: "asc" },
  });

  return variants.map(variantToShape);
}

export async function getSyncState(shop) {
  return prisma.syncState.findUnique({ where: { shop } });
}

// Shared loader for the five dashboard-family routes (app.dashboard,
// app.products, app.report, app.supplier-dashboard, app.purchase-orders):
// authenticates, then reads the Postgres mirror instead of paginating live
// Shopify calls. `syncPending` flags a shop whose nightly/manual sync hasn't
// completed a first run yet, so routes can show an empty-state banner
// instead of silently rendering zero parts.
export async function loadCatalogForRoute(request, { status = "ACTIVE" } = {}) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [variants, suppliers, syncState] = await Promise.all([
    getVariantsWithSources(shop, { status }),
    getSuppliers(shop),
    getSyncState(shop),
  ]);

  return {
    variants,
    suppliers,
    lastFullSyncAt: syncState?.lastFullSyncAt ?? null,
    syncPending: !syncState?.lastFullSyncAt,
  };
}

// Cheap health check for the sync — counts + last-run state, no DB shell
// access required. Backs the GET /api/sync?intent=status endpoint.
export async function getSyncStatus(shop) {
  const [syncState, variantCount, productCount, supplierCount] = await Promise.all([
    prisma.syncState.findUnique({ where: { shop } }),
    prisma.variant.count({ where: { shop } }),
    prisma.product.count({ where: { shop } }),
    prisma.supplier.count({ where: { shop } }),
  ]);

  return {
    shop,
    variantCount,
    productCount,
    supplierCount,
    lastFullSyncAt: syncState?.lastFullSyncAt ?? null,
    bulkStatus: syncState?.bulkStatus ?? null,
    bulkOperationId: syncState?.bulkOperationId ?? null,
    error: syncState?.error ?? null,
  };
}
