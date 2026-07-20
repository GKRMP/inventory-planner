import { resolveAdminAndShop } from "../services/cron-auth.server";
import {
  fetchRegisteredWebhooks as fetchRegistered,
  diffExpectedWebhooks as diffExpected,
} from "../services/webhook-registry.server";

// Registers webhook subscriptions directly through the Admin API, using the
// app's own already-installed session, for shops where `shopify app deploy`
// (which normally registers subscriptions declared in shopify.app.*.toml)
// can't be run because the account lacks Partner Dashboard org membership for
// this app's client_id. The expected set lives in webhook-registry.server.js,
// shared with the health check so the two can't drift.
//
// Not just one-time recovery: a rebuilt app gets a new client_id and starts
// with zero subscriptions, which is what silently froze the mirror on
// 2026-07-15. POST is idempotent (it creates only what's missing), so it's
// safe to call on a schedule to make registration self-healing.
//
// GET  /api/setup-webhook  — reports which are actually registered with
//      Shopify vs. missing (diagnostic only, no writes).
// POST /api/setup-webhook  — same auth as /api/sync (x-sync-secret header,
//      or embedded-admin session); creates only the ones that are missing.

export async function loader({ request }) {
  const { admin, shop } = await resolveAdminAndShop(request);
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) {
    return Response.json({ error: "SHOPIFY_APP_URL is not set" }, { status: 500 });
  }

  try {
    const registered = await fetchRegistered(admin);
    const status = diffExpected(appUrl, registered);
    return Response.json({
      shop,
      allRegistered: status.every((s) => s.registered),
      subscriptions: status,
    });
  } catch (error) {
    console.error(`Webhook status error for ${shop}:`, error);
    return Response.json({ error: error.message || "Webhook status check failed" }, { status: 500 });
  }
}

export async function action({ request }) {
  const { admin, shop } = await resolveAdminAndShop(request);
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) {
    return Response.json({ error: "SHOPIFY_APP_URL is not set" }, { status: 500 });
  }

  try {
    const registered = await fetchRegistered(admin);
    const status = diffExpected(appUrl, registered);
    const missing = status.filter((s) => !s.registered);

    const created = [];
    for (const item of missing) {
      const response = await admin.graphql(
        `
          mutation RegisterWebhook($callbackUrl: URL!) {
            webhookSubscriptionCreate(
              topic: ${item.topic}
              webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
            ) {
              webhookSubscription { id topic callbackUrl }
              userErrors { field message }
            }
          }
        `,
        { variables: { callbackUrl: item.callbackUrl } }
      );
      const result = await response.json();
      created.push({ topic: item.topic, result: result.data?.webhookSubscriptionCreate });
    }

    return Response.json({
      shop,
      alreadyRegistered: status.filter((s) => s.registered).map((s) => s.topic),
      created,
    });
  } catch (error) {
    console.error(`Webhook setup error for ${shop}:`, error);
    return Response.json({ error: error.message || "Webhook setup failed" }, { status: 500 });
  }
}
