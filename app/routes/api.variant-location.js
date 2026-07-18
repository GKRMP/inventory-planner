import { authenticate } from "../shopify.server";
import { writeThroughLocation, normalizeCrossRef } from "../services/sync.server";

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function mirrorWrite(shop, variantId, binLocation, crossRefs) {
  try {
    await writeThroughLocation(shop, variantId, binLocation, crossRefs);
  } catch (error) {
    console.error(`Variant location mirror write-through failed for ${shop}:`, error);
  }
}

// POST /api/variant-location
// Body: { variantIds: [gid, ...], binLocation, crossRefs: [...] }
// (a single variantId is also accepted for a per-variant form)
// Used by the products page bin/cross-ref editor and the CSV import path.
export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();

  const variantIds = body.variantIds || (body.variantId ? [body.variantId] : []);
  const binLocation = (body.binLocation || "").trim();
  const crossRefs = (body.crossRefs || []).map(normalizeCrossRef).filter(Boolean);

  if (!variantIds.length) {
    return Response.json({ error: "variantIds (or variantId) is required" }, { status: 400 });
  }

  // metafieldsSet caps at 25 metafields per call; this endpoint sets two
  // metafields per variant (location + cross_refs).
  const batchSize = 12;
  const results = { success: [], failed: [] };

  for (const batch of chunk(variantIds, batchSize)) {
    const metafields = [];
    for (const variantId of batch) {
      metafields.push({
        ownerId: variantId,
        namespace: "inventory",
        key: "location",
        type: "single_line_text_field",
        value: binLocation,
      });
      metafields.push({
        ownerId: variantId,
        namespace: "inventory",
        key: "cross_refs",
        type: "list.single_line_text_field",
        value: JSON.stringify(crossRefs),
      });
    }

    const response = await admin.graphql(
      `
        mutation SetVariantLocation($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              ownerId
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      { variables: { metafields } }
    );
    const result = await response.json();
    const userErrors = result?.data?.metafieldsSet?.userErrors || [];

    if (userErrors.length) {
      results.failed.push({ variantIds: batch, errors: userErrors });
      continue;
    }

    for (const variantId of batch) {
      await mirrorWrite(session.shop, variantId, binLocation, crossRefs);
      results.success.push(variantId);
    }
  }

  return Response.json(results);
}
