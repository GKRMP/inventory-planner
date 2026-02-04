import { Tabs } from "@shopify/polaris";
import { useNavigate, useLocation } from "react-router";

const navItems = [
  { id: "dashboard", content: "Dashboard", path: "/app/dashboard" },
  { id: "report", content: "Report", path: "/app/report" },
  { id: "products", content: "Products", path: "/app/products" },
  { id: "supplier-summary", content: "Supplier Summary", path: "/app/supplier-dashboard" },
  { id: "suppliers", content: "Suppliers", path: "/app/additional" },
  { id: "import", content: "Import", path: "/app/import" },
];

export default function AppNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  // Find the selected tab based on current path
  const selectedIndex = navItems.findIndex(
    (item) => location.pathname === item.path
  );

  const handleTabChange = (selectedTabIndex) => {
    const selectedTab = navItems[selectedTabIndex];
    if (selectedTab) {
      navigate(selectedTab.path);
    }
  };

  return (
    <div style={{ marginBottom: "16px" }}>
      <Tabs
        tabs={navItems}
        selected={selectedIndex >= 0 ? selectedIndex : 0}
        onSelect={handleTabChange}
      />
    </div>
  );
}
