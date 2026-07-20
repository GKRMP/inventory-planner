import prisma from "../db.server";

// Turns order history into per-variant demand signals. Raw order/line-item
// data is never stored — only the VariantSalesDay daily rollup, which
// recomputeVelocities aggregates into Variant.velocity30/90/365.
//
// AppStore-distributed apps only see the last 60 days of order history
// without an approved `read_all_orders` protected-data request (filed
// separately in the Partner dashboard). DEFAULT_BACKFILL_DAYS is capped
// accordingly; once `read_all_orders` is approved this can be raised.
const DEFAULT_BACKFILL_DAYS = 60;

function toGid(resource, id) {
  if (!id) return null;
  if (typeof id === "string" && id.startsWith("gid://")) return id;
  return `gid://shopify/${resource}/${id}`;
}

function dateOnly(iso) {
  return iso ? iso.slice(0, 10) : null;
}

const ORDERS_BULK_QUERY = (sinceISO) => `
  {
    orders(query: "created_at:>='${sinceISO}'") {
      edges {
        node {
          id
          createdAt
          cancelledAt
          test
          lineItems {
            edges {
              node {
                quantity
                variant { id }
                originalUnitPriceSet { shopMoney { amount } }
              }
            }
          }
        }
      }
    }
  }
`;

// Kicks off a bulk operation over recent orders + line items. Refuses to
// start if a bulk operation (catalog or orders) is already running for this
// shop — only one may run at a time. Callers should check
// SyncState.bulkOperationType after the bulk_operations/finish webhook fires
// to know which completion handler to run.
export async function startOrdersBulkSync(admin, shop, { days = DEFAULT_BACKFILL_DAYS } = {}) {
  const currentResp = await admin.graphql(`{ currentBulkOperation { id status } }`);
  const currentData = await currentResp.json();
  const current = currentData.data?.currentBulkOperation;
  if (current && (current.status === "RUNNING" || current.status === "CREATED")) {
    return { started: false, reason: "A bulk operation is already running", bulkOperationId: current.id };
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const response = await admin.graphql(
    `
      mutation StartOrdersBulkSync($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation { id status }
          userErrors { field message }
        }
      }
    `,
    { variables: { query: ORDERS_BULK_QUERY(since) } }
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
      bulkOperationType: "orders",
    },
    update: {
      bulkOperationId: result.bulkOperation.id,
      bulkStatus: result.bulkOperation.status,
      bulkOperationType: "orders",
      error: null,
    },
  });

  return { started: true, bulkOperationId: result.bulkOperation.id, since };
}

// Replaces VariantSalesDay rows for [since, today] with freshly aggregated
// totals from the bulk export — idempotent no matter how many times the
// backfill re-runs over the same window, unlike an increment-based write.
async function replaceSalesDayRange(shop, sinceDate, rowsByKey) {
  await prisma.$transaction([
    prisma.variantSalesDay.deleteMany({
      where: { shop, date: { gte: sinceDate } },
    }),
    ...(rowsByKey.size
      ? [
          prisma.variantSalesDay.createMany({
            data: Array.from(rowsByKey.values()),
          }),
        ]
      : []),
  ]);
}

// Called once Shopify reports the orders bulk operation finished. Downloads
// the JSONL, aggregates line items into daily per-variant totals, and
// replaces the backfilled date range in one shot.
export async function completeOrdersBulkSync(admin, shop, { since } = {}) {
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

  const sinceDate = since ? new Date(since) : new Date(Date.now() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000);

  if (!op.url) {
    await replaceSalesDayRange(shop, sinceDate, new Map());
    await prisma.syncState.upsert({
      where: { shop },
      create: { shop, bulkOperationId: op.id, bulkStatus: "COMPLETED", lastOrdersSyncAt: new Date() },
      update: { bulkOperationId: op.id, bulkStatus: "COMPLETED", lastOrdersSyncAt: new Date(), error: null },
    });
    return { ok: true, count: 0 };
  }

  const res = await fetch(op.url);
  const text = await res.text();
  const lines = text.split("\n").filter(Boolean);

  const orders = new Map(); // order gid -> { date, skip }
  const rowsByKey = new Map(); // `${variantId}|${date}` -> { shop, variantId, date, qty, revenue }

  // Bulk JSONL lists each order followed by its line-item children
  // (linked via __parentId) — two passes so line items always find their
  // parent regardless of ordering within the file.
  for (const line of lines) {
    const node = JSON.parse(line);
    if (node.__parentId) continue;
    orders.set(node.id, {
      date: dateOnly(node.createdAt),
      skip: !!node.cancelledAt || !!node.test,
    });
  }

  for (const line of lines) {
    const node = JSON.parse(line);
    if (!node.__parentId) continue;
    const order = orders.get(node.__parentId);
    if (!order || order.skip || !order.date) continue;

    const variantId = node.variant?.id;
    if (!variantId) continue;

    const qty = parseInt(node.quantity) || 0;
    const unitPrice = parseFloat(node.originalUnitPriceSet?.shopMoney?.amount) || 0;

    const key = `${variantId}|${order.date}`;
    const existing = rowsByKey.get(key);
    if (existing) {
      existing.qty += qty;
      existing.revenue += qty * unitPrice;
    } else {
      rowsByKey.set(key, {
        shop,
        variantId,
        date: new Date(order.date),
        qty,
        revenue: qty * unitPrice,
      });
    }
  }

  // Guard against replacing the window using a JSONL that isn't an orders
  // export. replaceSalesDayRange deletes before it inserts, so being handed
  // the wrong payload (e.g. a catalog op misrouted here by a stale
  // SyncState.bulkOperationType) would wipe the trailing window and write
  // nothing back, zeroing every velocity. Orders always carry createdAt;
  // productVariants never do, so a file of top-level nodes with no dates is
  // positively the wrong export. Bail without touching existing rows.
  const datedOrders = Array.from(orders.values()).filter((o) => o.date).length;
  if (lines.length && !datedOrders) {
    const reason = "Orders backfill aborted: bulk export contained no dated orders (wrong payload?)";
    console.error(`${reason} for ${shop}`);
    await prisma.syncState.updateMany({ where: { shop }, data: { error: reason } });
    return { ok: false, reason };
  }

  await replaceSalesDayRange(shop, sinceDate, rowsByKey);

  await prisma.syncState.upsert({
    where: { shop },
    create: { shop, bulkOperationId: op.id, bulkStatus: "COMPLETED", lastOrdersSyncAt: new Date() },
    update: { bulkOperationId: op.id, bulkStatus: "COMPLETED", lastOrdersSyncAt: new Date(), error: null },
  });

  return { ok: true, count: rowsByKey.size };
}

// Write-through for the orders/create webhook — adds one order's line items
// to the relevant days' totals. Uses increment rather than replace, since a
// single webhook only ever knows about one order at a time. Shopify
// redelivers webhooks at-least-once, so a duplicate delivery can double-count
// a day here; the nightly orders backfill (replaceSalesDayRange) is the
// authoritative reconcile that overwrites any such drift.
export async function applyOrderWebhook(shop, payload) {
  if (payload.cancelled_at || payload.test) return;

  const date = dateOnly(payload.created_at);
  if (!date) return;

  const lineItems = payload.line_items || [];
  const totals = new Map(); // variantId -> { qty, revenue }

  for (const item of lineItems) {
    const variantId = toGid("ProductVariant", item.variant_id);
    if (!variantId) continue;
    const qty = parseInt(item.quantity) || 0;
    const unitPrice = parseFloat(item.price) || 0;
    const existing = totals.get(variantId);
    if (existing) {
      existing.qty += qty;
      existing.revenue += qty * unitPrice;
    } else {
      totals.set(variantId, { qty, revenue: qty * unitPrice });
    }
  }

  for (const [variantId, { qty, revenue }] of totals) {
    await prisma.variantSalesDay.upsert({
      where: { shop_variantId_date: { shop, variantId, date: new Date(date) } },
      create: { shop, variantId, date: new Date(date), qty, revenue },
      update: { qty: { increment: qty }, revenue: { increment: revenue } },
    });
  }
}

// SQL group-bys over VariantSalesDay, written into Variant.velocity30/90/365
// as avg units/day. Run after the orders backfill completes and nightly from
// cron so velocities stay current even between backfills (webhooks keep
// VariantSalesDay warm day to day).
export async function recomputeVelocities(shop) {
  const windows = [
    { column: "velocity30", days: 30 },
    { column: "velocity90", days: 90 },
    { column: "velocity365", days: 365 },
  ];

  for (const { column, days } of windows) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await prisma.$executeRawUnsafe(
      `UPDATE "Variant" SET "${column}" = 0 WHERE shop = $1`,
      shop
    );
    await prisma.$executeRawUnsafe(
      `
        UPDATE "Variant" v
        SET "${column}" = s.qty::float / $3
        FROM (
          SELECT "variantId", SUM(qty) AS qty
          FROM "VariantSalesDay"
          WHERE shop = $1 AND date >= $2
          GROUP BY "variantId"
        ) s
        WHERE v.id = s."variantId" AND v.shop = $1
      `,
      shop,
      since,
      days
    );
  }

  await prisma.variant.updateMany({
    where: { shop },
    data: { velocityUpdatedAt: new Date() },
  });
}

// 12-bucket (by calendar month, all years combined) seasonality profile for
// one variant — used to spot seasonal parts a flat velocity blend would
// under/over-forecast.
export async function monthlyProfile(shop, variantId) {
  const rows = await prisma.$queryRaw`
    SELECT EXTRACT(MONTH FROM date)::int AS month, SUM(qty)::int AS qty
    FROM "VariantSalesDay"
    WHERE shop = ${shop} AND "variantId" = ${variantId}
    GROUP BY month
  `;
  const byMonth = new Map(rows.map((r) => [r.month, r.qty]));
  return Array.from({ length: 12 }, (_, i) => byMonth.get(i + 1) || 0);
}
