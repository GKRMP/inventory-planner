import { authenticate } from "../shopify.server";
import { fetchVariantsPage } from "../services/shopify-catalog.server";

// Loads catalog data one page (250 variants) at a time. The client
// (ProductsContext) drives pagination by calling this repeatedly with the
// cursor from the previous response and appending results — this keeps each
// request comfortably under Shopify's query cost cap and means a failed page
// never silently truncates the catalog into a falsely "complete" state.
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "loadPage") {
    const statusFilter = formData.get("statusFilter") || "ACTIVE";
    const cursor = formData.get("cursor") || null;

    try {
      const { variants, pageInfo } = await fetchVariantsPage(admin, {
        cursor,
        status: statusFilter,
      });
      return { variants, pageInfo };
    } catch (error) {
      console.error("Error fetching variants page:", error);
      return { error: error.message || "Failed to load products page", isComplete: false };
    }
  }

  return { error: "Unknown intent" };
}
