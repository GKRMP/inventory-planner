import { useState, useMemo } from "react";
import {
  Page,
  Layout,
  Card,
  Tabs,
  Spinner,
  Button,
  InlineStack,
  Banner,
} from "@shopify/polaris";

import { useInventoryRisk } from "../hooks/useInventoryRisk";
import RiskTable from "../components/RiskTable";

export default function InventoryRisk() {
  const { risk, loading, error, refresh } = useInventoryRisk();
  const [selectedTab, setSelectedTab] = useState(0);

  const tabs = [
    { id: "all", content: "All SKUs" },
    { id: "top50", content: "Top 50 at Risk" },
  ];

  // Compute displayed data based on tab selection
  const displayedData = useMemo(() => {
    if (selectedTab === 0) return risk;

    return risk
      .filter((r) => r.daily_demand > 0)
      .sort((a, b) => a.days_until_stockout - b.days_until_stockout)
      .slice(0, 50);
  }, [risk, selectedTab]);

  return (
    <Page
      title="Inventory Risk"
      subtitle="Forecasted stock-out dates, reorder points, and supplier planning"
      primaryAction={{
        content: "Refresh",
        onAction: refresh,
      }}
    >
      <Layout>
        <Layout.Section>

          {/* Error Banner */}
          {error && (
            <Banner status="critical" title="Error loading inventory risk data">
              <p>{error}</p>
            </Banner>
          )}

          {/* Tabs */}
          <Tabs
            tabs={tabs}
            selected={selectedTab}
            onSelect={setSelectedTab}
          />

          <Card>
            {loading ? (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Spinner size="large" />
              </div>
            ) : (
              <RiskTable rows={displayedData} />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}