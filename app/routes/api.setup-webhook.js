import { resolveAdminAndShop } from "../services/cron-auth.server";

// One-time setup: registers the bulk_operations/finish webhook subscription
// directly through the Admin API, using the app's own already-installed
// session. Exists because `shopify app deploy` (which normally registers
// subscriptions declared in shopify.app.*.toml) requires Partner Dashboard
// org membership — this works from the app's install alone. POST it once
// per shop the same way you trigger /api/sync (x-sync-secret header, or an
// embedded-admin session).
const TOPIC = "BULK_OPERATIONS_FINISH";

export async function action({ request }) {
  const { admin, shop } = await resolveAdminAndShop(request);

  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) {
    return Response.json({ error: "SHOPIFY_APP_URL is not set" }, { status: 500 });
  }
  const callbackUrl = `${appUrl.replace(/\/$/, "")}/webhooks/bulk_operations/finish`;

  try {
    const existingResp = await admin.graphql(`
      { webhookSubscriptions(first: 5, topics: [${TOPIC}]) { edges { node { id callbackUrl } } } }
    `);
    const existingData = await existingResp.json();
    const already = existingData.data?.webhookSubscriptions?.edges?.find(
      (e) => e.node.callbackUrl === callbackUrl
    );
    if (already) {
      return Response.json({ ok: true, shop, alreadyRegistered: true, id: already.node.id });
    }

    const response = await admin.graphql(
      `
        mutation RegisterBulkOpFinish($callbackUrl: URL!) {
          webhookSubscriptionCreate(
            topic: ${TOPIC}
            webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
          ) {
            webhookSubscription { id topic callbackUrl }
            userErrors { field message }
          }
        }
      `,
      { variables: { callbackUrl } }
    );
    const result = await response.json();
    return Response.json(result);
  } catch (error) {
    console.error(`Webhook setup error for ${shop}:`, error);
    return Response.json({ error: error.message || "Webhook setup failed" }, { status: 500 });
  }
}
