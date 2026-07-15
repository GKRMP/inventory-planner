import { authenticate } from "../shopify.server";
import { writeThroughSourcingType } from "../services/sync.server";

const VALID_TYPES = ["nos", "repro", "resale"];

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function mirrorWrite(shop, variantId, sourcingType, reproSettings) {
  try {
    await writeThroughSourcingType(shop, variantId, sourcingType, reproSettings);
  } catch (error) {
    console.error(`Sourcing type mirror write-through failed for ${shop}:`, error);
  }
}

// POST /api/sourcing-type
// Body: { variantIds: [gid, ...], sourcingType: "nos"|"repro"|"resale", reproSettings?: {...} }
// (a single variantId is also accepted for the per-variant modal in app.products.jsx)
// Used by both the single-variant modal and the vendor bulk-set toolbar.
export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();

  const variantIds = body.variantIds || (body.variantId ? [body.variantId] : []);
  const sourcingType = body.sourcingType;
  const reproSettings = sourcingType === "repro" ? body.reproSettings || {} : null;

  if (!variantIds.length || !VALID_TYPES.includes(sourcingType)) {
    return Response.json(
      { error: "variantIds (or variantId) and a valid sourcingType (nos|repro|resale) are required" },
      { status: 400 }
    );
  }

  // metafieldsSet caps at 25 metafields per call; repro sets two metafields
  // per variant (sourcing_type + repro_settings), everything else sets one.
  const fieldsPerVariant = sourcingType === "repro" ? 2 : 1;
  const batchSize = Math.max(1, Math.floor(25 / fieldsPerVariant));

  const mutation = `
    mutation SetSourcingType($metafields: [MetafieldsSetInput!]!) {
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
  `;

  const results = { success: [], failed: [] };

  for (const batch of chunk(variantIds, batchSize)) {
    const metafields = [];
    for (const variantId of batch) {
      metafields.push({
        ownerId: variantId,
        namespace: "inventory",
        key: "sourcing_type",
        type: "single_line_text_field",
        value: sourcingType,
      });
      if (sourcingType === "repro") {
        metafields.push({
          ownerId: variantId,
          namespace: "inventory",
          key: "repro_settings",
          type: "json",
          value: JSON.stringify(reproSettings),
        });
      }
    }

    const response = await admin.graphql(mutation, { variables: { metafields } });
    const result = await response.json();
    const userErrors = result?.data?.metafieldsSet?.userErrors || [];

    if (userErrors.length) {
      results.failed.push({ variantIds: batch, errors: userErrors });
      continue;
    }

    for (const variantId of batch) {
      await mirrorWrite(session.shop, variantId, sourcingType, reproSettings);
      results.success.push(variantId);
    }
  }

  return Response.json(results);
}
