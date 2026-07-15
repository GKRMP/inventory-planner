import { authenticate } from "../shopify.server";
import { applyOrderWebhook } from "../services/demand.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await applyOrderWebhook(shop, payload);
  } catch (error) {
    console.error(`Failed to mirror ${topic} webhook for ${shop}:`, error);
  }

  return new Response();
};
