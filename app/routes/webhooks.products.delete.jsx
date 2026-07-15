import { authenticate } from "../shopify.server";
import { deleteProductMirror } from "../services/sync.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const productId = payload.admin_graphql_api_id || `gid://shopify/Product/${payload.id}`;
    await deleteProductMirror(productId);
  } catch (error) {
    console.error(`Failed to mirror ${topic} webhook for ${shop}:`, error);
  }

  return new Response();
};
