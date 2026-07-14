import { authenticate } from "../shopify.server";
import { writeThroughSupplierData } from "../services/sync.server";

async function mirrorWrite(shop, variantId, supplierData) {
  try {
    await writeThroughSupplierData(shop, variantId, supplierData);
  } catch (error) {
    console.error(`Variant supplier-data mirror write-through failed for ${shop}:`, error);
  }
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();

  const { variantId, supplierData } = body;

  // First, check if the metafield already exists
  const checkQuery = `
    query GetVariantMetafield($id: ID!) {
      productVariant(id: $id) {
        id
        metafield(namespace: "inventory", key: "supplier_data") {
          id
        }
      }
    }
  `;

  const checkResponse = await admin.graphql(checkQuery, {
    variables: { id: variantId },
  });
  const checkData = await checkResponse.json();

  const metafieldId = checkData.data?.productVariant?.metafield?.id;

  if (metafieldId) {
    // Update existing metafield
    const updateMutation = `
      mutation UpdateMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await admin.graphql(updateMutation, {
      variables: {
        metafields: [
          {
            ownerId: variantId,
            namespace: "inventory",
            key: "supplier_data",
            type: "json",
            value: supplierData,
          },
        ],
      },
    });

    const result = await response.json();
    if (!result?.data?.metafieldsSet?.userErrors?.length) {
      await mirrorWrite(session.shop, variantId, supplierData);
    }
    return result;
  } else {
    // Create new metafield
    const createMutation = `
      mutation CreateMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await admin.graphql(createMutation, {
      variables: {
        metafields: [
          {
            ownerId: variantId,
            namespace: "inventory",
            key: "supplier_data",
            type: "json",
            value: supplierData,
          },
        ],
      },
    });

    const result = await response.json();
    if (!result?.data?.metafieldsSet?.userErrors?.length) {
      await mirrorWrite(session.shop, variantId, supplierData);
    }
    return result;
  }
}
