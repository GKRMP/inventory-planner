import { authenticate } from "../shopify.server";

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
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

    return await response.json();
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

    return await response.json();
  }
}
