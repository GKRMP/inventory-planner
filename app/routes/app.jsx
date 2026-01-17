import { Outlet, useLoaderData } from "react-router-dom";
import { authenticate } from "../shopify.server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider, Frame } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <ShopifyAppProvider apiKey={apiKey} embedded>
      <PolarisAppProvider i18n={enTranslations}>
        <Frame>
          <Outlet />
        </Frame>
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}