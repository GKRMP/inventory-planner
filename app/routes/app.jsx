import { Outlet, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider, Frame } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { ProductsProvider } from "../context/ProductsContext";
import { fetchVariantsPage, fetchAllSuppliers } from "../services/shopify-catalog.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    const [{ variants, pageInfo }, suppliers] = await Promise.all([
      fetchVariantsPage(admin, { status: "ACTIVE" }),
      fetchAllSuppliers(admin),
    ]);

    return {
      apiKey: process.env.SHOPIFY_API_KEY || "",
      variants,
      suppliers,
      hasMoreProducts: pageInfo.hasNextPage,
      cursor: pageInfo.endCursor || null,
    };
  } catch (error) {
    console.error("App loader error:", error);
    return {
      apiKey: process.env.SHOPIFY_API_KEY || "",
      variants: [],
      suppliers: [],
      hasMoreProducts: false,
      cursor: null,
      loadError: error.message || "Failed to load initial catalog data",
    };
  }
};

export default function App() {
  const { apiKey, variants, suppliers, hasMoreProducts, cursor, loadError } = useLoaderData();

  return (
    <ShopifyAppProvider apiKey={apiKey} embedded>
      <PolarisAppProvider i18n={enTranslations}>
        <ProductsProvider
          initialVariants={variants}
          initialSuppliers={suppliers}
          hasMoreProducts={hasMoreProducts}
          initialCursor={cursor}
          initialLoadError={loadError || null}
        >
          <Frame>
            <Outlet />
          </Frame>
        </ProductsProvider>
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}
