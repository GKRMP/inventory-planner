import { authenticate, unauthenticated } from "../shopify.server";
import { startBulkSync, completeBulkSync } from "../services/sync.server";

// Triggers a full catalog bulk sync. Called either from the embedded admin
// (manual "Sync now" button, session-authenticated) or by the Render Cron
// Job (x-sync-secret header, offline session looked up by shop domain since
// a cron job has no browser session to authenticate with).
async function resolveAdminAndShop(request) {
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

export async function action({ request }) {
  const { admin, shop } = await resolveAdminAndShop(request);
  const url = new URL(request.url);
  const intent = url.searchParams.get("intent") || "start";

  try {
    if (intent === "complete") {
      const result = await completeBulkSync(admin, shop);
      return Response.json(result);
    }

    const result = await startBulkSync(admin, shop);
    return Response.json(result);
  } catch (error) {
    console.error(`Sync ${intent} error for ${shop}:`, error);
    return Response.json({ error: error.message || "Sync failed" }, { status: 500 });
  }
}
