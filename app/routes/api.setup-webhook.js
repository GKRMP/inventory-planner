import { resolveAdminAndShop } from "../services/cron-auth.server";

// One-time recovery: registers webhook subscriptions directly through the
// Admin API, using the app's own already-installed session, for shops where
// `shopify app deploy` (which normally registers subscriptions declared in
// shopify.app.*.toml) can't be run because the account lacks Partner
// Dashboard org membership for this app's client_id. Mirrors the five
// subscriptions declared in shopify.app.inventory-planner-422p.toml.
//
// GET  /api/setup-webhook  — reports which of the five are actually
//      registered with Shopify vs. missing (diagnostic only, no writes).
// POST /api/setup-webhook  — same auth as /api/sync (x-sync-secret header,
//      or embedded-admin session); creates only the ones that are missing.
const EXPECTED = [
  { topic: "PRODUCTS_CREATE", path: "/webhooks/products/create" },
  { topic: "PRODUCTS_UPDATE", path: "/webhooks/products/update" },
  { topic: "PRODUCTS_DELETE", path: "/webhooks/products/delete" },
  { topic: "INVENTORY_LEVELS_UPDATE", path: "/webhooks/inventory_levels/update" },
  { topic: "BULK_OPERATIONS_FINISH", path: "/webhooks/bulk_operations/finish" },
  { topic: "ORDERS_CREATE", path: "/webhooks/orders/create" },
];

function callbackUrlFor(appUrl, path) {
  return `${appUrl.replace(/\/$/, "")}${path}`;
}

async function fetchRegistered(admin) {
  const response = await admin.graphql(`
    { webhookSubscriptions(first: 50) { edges { node { id topic callbackUrl } } } }
  `);
  const data = await response.json();
  return data.data?.webhookSubscriptions?.edges?.map((e) => e.node) || [];
}

function diffExpected(appUrl, registered) {
  return EXPECTED.map((exp) => {
    const callbackUrl = callbackUrlFor(appUrl, exp.path);
    const match = registered.find((r) => r.topic === exp.topic && r.callbackUrl === callbackUrl);
    return { ...exp, callbackUrl, registered: !!match, id: match?.id || null };
  });
}

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
