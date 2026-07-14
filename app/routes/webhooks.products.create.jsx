import { authenticate } from "../shopify.server";
import { mirrorProductWebhookPayload } from "../services/sync.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await mirrorProductWebhookPayload(shop, payload);
  } catch (error) {
    console.error(`Failed to mirror ${topic} webhook for ${shop}:`, error);
  }

  return new Response();
};
