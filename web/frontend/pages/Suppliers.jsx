import { Page, Layout, Card, Spinner, Banner, Button } from "@shopify/polaris";
import { useNavigate } from "react-router-dom";

import { useSupplierParts } from "../hooks/useSupplierParts";
import SupplierPartTable from "../components/SupplierPartTable";

export default function SupplierParts() {
  const navigate = useNavigate();

  const { parts, loading, error, refresh } = useSupplierParts();

  return (
    <Page
      title="Supplier–Part Links"
      subtitle="Manage supplier associations, lead times, thresholds, and last order details"
      primaryAction={{
        content: "Add Supplier Link",
        onAction: () => navigate("/supplier-parts/new"),
      }}
      secondaryActions={[
        {
          content: "Refresh",
          onAction: refresh,
        },
      ]}
    >
      <Layout>
        <Layout.Section>

          {/* Error Banner */}
          {error && (
            <Banner status="critical" title="Error loading supplier-part links">
              <p>{error}</p>
            </Banner>
          )}

          <Card>
            {loading ? (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Spinner size="large" />
              </div>
            ) : (
              <SupplierPartTable rows={parts} />
            )}
          </Card>
        </Layout.Section>
		<SupplierTable rows={suppliers} onDeleted={refresh} />
      </Layout>
    </Page>
  );
}