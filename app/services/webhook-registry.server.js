// The webhook subscriptions this app depends on, and the logic to check
// which are actually registered with Shopify. Shared by api.setup-webhook.js
// (which registers missing ones) and health.server.js (which alerts on them)
// so the two can't drift on the expected set.
//
// Mirrors the subscriptions declared in shopify.app.inventory-planner-422p.toml.
// Those are normally registered by `shopify app deploy`; this API-based path
// exists for shops where that can't be run (no Partner Dashboard org
// membership for the app's client_id).
//
// Registering a new app's client_id starts it with zero subscriptions — this
// is exactly how the 2026-07-15 rebuild silently froze the catalog mirror for
// five days, so treat a missing subscription as a production incident, not a
// warning.
export const EXPECTED_WEBHOOKS = [
  { topic: "PRODUCTS_CREATE", path: "/webhooks/products/create" },
  { topic: "PRODUCTS_UPDATE", path: "/webhooks/products/update" },
  { topic: "PRODUCTS_DELETE", path: "/webhooks/products/delete" },
  { topic: "INVENTORY_LEVELS_UPDATE", path: "/webhooks/inventory_levels/update" },
  { topic: "BULK_OPERATIONS_FINISH", path: "/webhooks/bulk_operations/finish" },
  { topic: "ORDERS_CREATE", path: "/webhooks/orders/create" },
];

export function callbackUrlFor(appUrl, path) {
  return `${appUrl.replace(/\/$/, "")}${path}`;
}

export async function fetchRegisteredWebhooks(admin) {
  const response = await admin.graphql(`
    { webhookSubscriptions(first: 50) { edges { node { id topic callbackUrl } } } }
  `);
  const data = await response.json();
  return data.data?.webhookSubscriptions?.edges?.map((e) => e.node) || [];
}

// Matches on topic + exact callback URL: a subscription pointing at a stale
// app URL (e.g. left over from a previous deployment) is reported as missing,
// since it won't deliver anything useful to this instance.
export function diffExpectedWebhooks(appUrl, registered) {
  return EXPECTED_WEBHOOKS.map((exp) => {
    const callbackUrl = callbackUrlFor(appUrl, exp.path);
    const match = registered.find((r) => r.topic === exp.topic && r.callbackUrl === callbackUrl);
    return { ...exp, callbackUrl, registered: !!match, id: match?.id || null };
  });
}
