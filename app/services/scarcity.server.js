import prisma from "../db.server";

// Three NOS-only reports surfaced on app.report.jsx. All read from the
// Postgres mirror (Variant.sourcingType/velocity* + VariantSalesDay) — no
// Shopify calls, so these are cheap to render alongside the existing report.

// Dead stock: still on the shelf, never sold in the trailing year. velocity365
// is a rolling average from VariantSalesDay, so null/0 means zero sales in
// that window even if the part has been in stock the whole time.
export async function getDeadStock(shop, { limit = 100 } = {}) {
  return prisma.$queryRaw`
    SELECT v.id, v.sku, v.title AS "variantTitle", p.title AS "productTitle",
           v."inventoryQuantity", v."binLocation"
    FROM "Variant" v
    JOIN "Product" p ON p.id = v."productId"
    WHERE v.shop = ${shop} AND v."sourcingType" = 'nos' AND v."inventoryQuantity" > 0
      AND (v.velocity365 IS NULL OR v.velocity365 = 0)
    ORDER BY v."inventoryQuantity" DESC
    LIMIT ${limit}
  `;
}

// Fast-mover, underpriced: NOS parts selling faster (trailing 30 days) than
// the 75th percentile of the whole active catalog. A NOS part that scarce and
// that much in demand is a pricing opportunity, not a reorder decision.
export async function getFastMoverUnderpriced(shop, { limit = 50 } = {}) {
  return prisma.$queryRaw`
    WITH catalog AS (
      SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY velocity30) AS p75
      FROM "Variant"
      WHERE shop = ${shop} AND velocity30 > 0
    )
    SELECT v.id, v.sku, v.title AS "variantTitle", p.title AS "productTitle",
           v."inventoryQuantity", v.velocity30, v."binLocation"
    FROM "Variant" v
    JOIN "Product" p ON p.id = v."productId"
    CROSS JOIN catalog c
    WHERE v.shop = ${shop} AND v."sourcingType" = 'nos' AND c.p75 IS NOT NULL AND v.velocity30 > c.p75
    ORDER BY v.velocity30 DESC
    LIMIT ${limit}
  `;
}

// Repro candidates: NOS parts that are completely gone (onHand <= 0) but have
// real lifetime demand — worth tooling up a production run for instead of
// waiting for another barn find.
export async function getReproCandidates(shop, { threshold = 10, limit = 50 } = {}) {
  return prisma.$queryRaw`
    SELECT v.id, v.sku, v.title AS "variantTitle", p.title AS "productTitle",
           v."inventoryQuantity", s.total AS "lifetimeQty"
    FROM "Variant" v
    JOIN "Product" p ON p.id = v."productId"
    JOIN (
      SELECT "variantId", SUM(qty)::int AS total
      FROM "VariantSalesDay"
      WHERE shop = ${shop}
      GROUP BY "variantId"
    ) s ON s."variantId" = v.id
    WHERE v.shop = ${shop} AND v."sourcingType" = 'nos' AND v."inventoryQuantity" <= 0
      AND s.total > ${threshold}
    ORDER BY s.total DESC
    LIMIT ${limit}
  `;
}

export async function getScarcityReports(shop) {
  const [deadStock, fastMoverUnderpriced, reproCandidates] = await Promise.all([
    getDeadStock(shop),
    getFastMoverUnderpriced(shop),
    getReproCandidates(shop),
  ]);
  return { deadStock, fastMoverUnderpriced, reproCandidates };
}
