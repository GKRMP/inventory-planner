import { authenticate, unauthenticated } from "../shopify.server";

// Shared by non-interactive admin routes (api.sync.jsx, api.setup-webhook.js):
// accepts either an embedded-admin session, or an `x-sync-secret` header for
// callers with no browser session — the Render Cron Job, or a one-off curl
// (e.g. registering a webhook subscription without Partner Dashboard access).
export async function resolveAdminAndShop(request) {
  const syncSecret = request.headers.get("x-sync-secret");
  if (syncSecret) {
    if (!process.env.SYNC_SECRET || syncSecret !== process.env.SYNC_SECRET) {
      throw new Response("Unauthorized", { status: 401 });
    }
    const shop = new URL(request.url).searchParams.get("shop");
    if (!shop) throw new Response("Missing shop query parameter", { status: 400 });
    const { admin } = await unauthenticated.admin(shop);
    return { admin, shop };
  }

  const { admin, session } = await authenticate.admin(request);
  return { admin, shop: session.shop };
}
