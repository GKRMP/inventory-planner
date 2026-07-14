import prisma from "../db.server";
import { fetchAllSuppliers } from "./shopify-catalog.server";

// Postgres mirror of the Shopify catalog + supplier metaobjects. Metafields
// and metaobjects in Shopify remain the source of truth — every function
// here is a best-effort cache write. Callers should treat failures as
// non-fatal (log, don't throw into a request that already committed to
// Shopify) since the nightly bulk sync heals any drift.

const BULK_VARIANTS_QUERY = `
  {
    productVariants {
      edges {
        node {
          id
          sku
          title
          inventoryQuantity
          inventoryItem {
            id
          }
          product {
            id
            title
            status
            vendor
          }
          metafield(namespace: "inventory", key: "supplier_data") {
            value
          }
        }
      }
    }
  }
`;

function safeParseJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Extracts per-source rows from a variant's supplier_data metafield JSON.
// Shared by the bulk sync and metafield write-through so the two paths can't drift.
export function parseSupplierData(raw) {
  const parsed = safeParseJson(raw);
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed : [{ ...parsed, is_primary: true }];
}

export async function upsertVariantSources(shop, variantId, raw) {
  const sources = parseSupplierData(raw);

  await prisma.$transaction([
    prisma.variantSource.deleteMany({ where: { shop, variantId } }),
    ...(sources.length
      ? [
          prisma.variantSource.createMany({
            data: sources.map((s) => ({
              shop,
              variantId,
              supplierId: s.supplier_id || null,
              mpn: s.mpn || null,
              isPrimary: !!s.is_primary,
              leadTime: Number.isFinite(parseInt(s.lead_time)) ? parseInt(s.lead_time) : null,
              threshold: Number.isFinite(parseInt(s.threshold)) ? parseInt(s.threshold) : null,
              dailyDemand: Number.isFinite(parseFloat(s.daily_demand))
                ? parseFloat(s.daily_demand)
                : null,
              lastOrderDate: s.last_order_date || null,
              lastOrderCpu: Number.isFinite(parseFloat(s.last_order_cpu))
                ? parseFloat(s.last_order_cpu)
                : null,
              lastOrderQty: Number.isFinite(parseInt(s.last_order_quantity))
                ? parseInt(s.last_order_quantity)
                : null,
              notes: s.notes || null,
            })),
          }),
        ]
      : []),
  ]);
}

// Mirrors one variant (+ its parent product) into Postgres. `supplierDataRaw`
// is optional — omit it (leave undefined) when the caller doesn't have fresh
// supplier_data (e.g. a products/update webhook payload), so an update never
// clobbers a value it doesn't actually know.
export async function upsertVariantMirror(shop, fields) {
  const { id, sku, title, inventoryQuantity, inventoryItemId, product, supplierDataRaw } = fields;

  if (product?.id) {
    await prisma.product.upsert({
      where: { id: product.id },
      create: {
        id: product.id,
        shop,
        title: product.title || "Unknown",
        status: product.status || "ACTIVE",
        vendor: product.vendor || null,
      },
      update: {
        ...(product.title !== undefined ? { title: product.title } : {}),
        ...(product.status !== undefined ? { status: product.status } : {}),
        ...(product.vendor !== undefined ? { vendor: product.vendor } : {}),
      },
    });
  }

  await prisma.variant.upsert({
    where: { id },
    create: {
      id,
      shop,
      productId: product.id,
      sku: sku ?? null,
      title: title ?? null,
      inventoryQuantity: inventoryQuantity ?? 0,
      inventoryItemId: inventoryItemId ?? null,
      supplierDataRaw: supplierDataRaw ?? undefined,
    },
    update: {
      ...(product?.id !== undefined ? { productId: product.id } : {}),
      ...(sku !== undefined ? { sku } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(inventoryQuantity !== undefined ? { inventoryQuantity } : {}),
      ...(inventoryItemId !== undefined ? { inventoryItemId } : {}),
      ...(supplierDataRaw !== undefined ? { supplierDataRaw } : {}),
    },
  });

  if (supplierDataRaw !== undefined) {
    await upsertVariantSources(shop, id, supplierDataRaw);
  }
}

// Write-through helper for api.variant-supplier.js / api.bulk-import-variant-suppliers.js:
// only touches the supplier_data mirror, since those endpoints don't have
// full product/variant context. If the variant row doesn't exist yet (mirror
// hasn't run its first sync), this is a no-op — the next bulk sync catches it up.
export async function writeThroughSupplierData(shop, variantId, rawSupplierDataJson) {
  const parsed = safeParseJson(rawSupplierDataJson);
  await prisma.variant.updateMany({
    where: { id: variantId, shop },
    data: { supplierDataRaw: parsed ?? undefined },
  });
  await upsertVariantSources(shop, variantId, parsed);
}

export async function deleteVariantMirror(id) {
  await prisma.variant.deleteMany({ where: { id } });
}

export async function deleteProductMirror(productId) {
  // Variant + VariantSource rows cascade via the Product/Variant onDelete: Cascade relations.
  await prisma.product.deleteMany({ where: { id: productId } });
}

export async function upsertSupplierMirror(shop, node) {
  const fv = (key) => node.fields.find((f) => f.key === key)?.value || null;
  const supplierId = fv("supplier_id");
  if (!supplierId) return;

  const data = {
    supplierId,
    name: fv("supplier_name") || "Unknown",
    specializedMfg: fv("specialized_mfg") === "true",
    contactName: fv("contact_name"),
    contactName2: fv("contact_name_2"),
    address: fv("address"),
    address2: fv("address_2"),
    city: fv("city"),
    state: fv("state"),
    zip: fv("zip"),
    country: fv("country"),
    phone1: fv("phone_1"),
    phone2: fv("phone_2"),
    email1: fv("email_1"),
    email2: fv("email_2"),
    website: fv("website"),
    notes: fv("notes"),
  };

  await prisma.supplier.upsert({
    where: { id: node.id },
    create: { id: node.id, shop, ...data },
    update: data,
  });
}

export async function deleteSupplierMirror(id) {
  await prisma.supplier.deleteMany({ where: { id } });
}

function toGid(resource, id) {
  if (!id) return null;
  if (typeof id === "string" && id.startsWith("gid://")) return id;
  return `gid://shopify/${resource}/${id}`;
}

// Shared by webhooks.products.create.jsx and webhooks.products.update.jsx.
// The REST-style webhook payload doesn't carry metafields, so
// supplierDataRaw is left untouched — supplier_data stays whatever the
// mirror already has until the next full sync or a write-through save.
export async function mirrorProductWebhookPayload(shop, payload) {
  const productId = toGid("Product", payload.admin_graphql_api_id || payload.id);
  const product = {
    id: productId,
    title: payload.title || "Unknown",
    status: (payload.status || "active").toUpperCase(),
    vendor: payload.vendor || null,
  };

  const variants = payload.variants || [];
  for (const v of variants) {
    const variantId = toGid("ProductVariant", v.admin_graphql_api_id || v.id);
    if (!variantId) continue;
    await upsertVariantMirror(shop, {
      id: variantId,
      sku: v.sku,
      title: v.title,
      inventoryItemId: toGid("InventoryItem", v.inventory_item_id),
      product,
    });
  }
}

async function flushVariantBatch(shop, nodes) {
  for (const node of nodes) {
    await upsertVariantMirror(shop, {
      id: node.id,
      sku: node.sku,
      title: node.title,
      inventoryQuantity: node.inventoryQuantity ?? 0,
      inventoryItemId: node.inventoryItem?.id || null,
      product: node.product,
      supplierDataRaw: node.metafield?.value ? safeParseJson(node.metafield.value) : null,
    });
  }
}

// Kicks off a full-catalog bulk operation. Refuses to start a second one —
// only one bulk operation may run per shop at a time. Also refreshes the
// supplier mirror inline since metaobjects aren't part of the bulk query.
export async function startBulkSync(admin, shop) {
  const currentResp = await admin.graphql(`{ currentBulkOperation { id status } }`);
  const currentData = await currentResp.json();
  const current = currentData.data?.currentBulkOperation;
  if (current && (current.status === "RUNNING" || current.status === "CREATED")) {
    return { started: false, reason: "A bulk operation is already running", bulkOperationId: current.id };
  }

  const response = await admin.graphql(
    `
      mutation StartBulkSync($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation { id status }
          userErrors { field message }
        }
      }
    `,
    { variables: { query: BULK_VARIANTS_QUERY } }
  );
  const data = await response.json();
  const result = data.data?.bulkOperationRunQuery;
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((e) => e.message).join("; "));
  }

  await prisma.syncState.upsert({
    where: { shop },
    create: {
      shop,
      bulkOperationId: result.bulkOperation.id,
      bulkStatus: result.bulkOperation.status,
    },
    update: {
      bulkOperationId: result.bulkOperation.id,
      bulkStatus: result.bulkOperation.status,
      error: null,
    },
  });

  try {
    const suppliers = await fetchAllSuppliers(admin);
    for (const node of suppliers) {
      await upsertSupplierMirror(shop, node);
    }
  } catch (error) {
    console.error(`Supplier mirror refresh failed for ${shop}:`, error);
    await prisma.syncState.updateMany({ where: { shop }, data: { error: error.message } });
  }

  return { started: true, bulkOperationId: result.bulkOperation.id };
}

// Called once Shopify reports the bulk operation finished (via the
// bulk_operations/finish webhook, or a manual poll for the "Sync now"
// button). Downloads the JSONL result and streams it into the mirror in
// batches.
export async function completeBulkSync(admin, shop) {
  const response = await admin.graphql(`
    {
      currentBulkOperation {
        id
        status
        errorCode
        url
      }
    }
  `);
  const data = await response.json();
  const op = data.data?.currentBulkOperation;
  if (!op) return { ok: false, reason: "No bulk operation found" };

  if (op.status !== "COMPLETED") {
    await prisma.syncState.updateMany({
      where: { shop },
      data: { bulkStatus: op.status, error: op.errorCode || null },
    });
    return { ok: false, reason: `Bulk operation status: ${op.status}` };
  }

  if (!op.url) {
    await prisma.syncState.upsert({
      where: { shop },
      create: { shop, bulkOperationId: op.id, bulkStatus: "COMPLETED", lastFullSyncAt: new Date() },
      update: { bulkOperationId: op.id, bulkStatus: "COMPLETED", lastFullSyncAt: new Date(), error: null },
    });
    return { ok: true, count: 0 };
  }

  const res = await fetch(op.url);
  const text = await res.text();
  const lines = text.split("\n").filter(Boolean);

  const BATCH_SIZE = 100;
  let batch = [];
  for (const line of lines) {
    const node = JSON.parse(line);
    // Flat productVariants query — no nested children expected, but skip
    // defensively in case Shopify ever nests something under this query.
    if (node.__parentId) continue;
    batch.push(node);
    if (batch.length >= BATCH_SIZE) {
      await flushVariantBatch(shop, batch);
      batch = [];
    }
  }
  if (batch.length) await flushVariantBatch(shop, batch);

  await prisma.syncState.upsert({
    where: { shop },
    create: { shop, bulkOperationId: op.id, bulkStatus: "COMPLETED", lastFullSyncAt: new Date() },
    update: { bulkOperationId: op.id, bulkStatus: "COMPLETED", lastFullSyncAt: new Date(), error: null },
  });

  return { ok: true, count: lines.length };
}
