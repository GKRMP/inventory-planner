import { AppProvider } from "@shopify/polaris";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./AppRoutes";
import en from "@shopify/polaris/locales/en.json";
import { NavigationMenu } from "@shopify/app-bridge-react";

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider i18n={en}>
        <NavigationMenu
          navigationLinks={[
            {
              label: "Inventory Risk",
              destination: "/inventory-risk",
            },
            {
              label: "Suppliers",
              destination: "/suppliers",
            },
            {
              label: "Supplier–Part Links",
              destination: "/supplier-parts",
            },
          ]}
        />
        <AppRoutes />
      </AppProvider>
    </BrowserRouter>
  );
}