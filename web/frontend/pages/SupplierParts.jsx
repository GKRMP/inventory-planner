import { useEffect, useState } from "react";
import { Page, Layout, Card, Button, Spinner } from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import SupplierPartTable from "../components/SupplierPartTable";

export default function SupplierParts() {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchParts() {
      const res = await fetch("/api/supplier-parts");
      const data = await res.json();
      setRecords(data);
      setLoading(false);
    }
    fetchParts();
  }, []);

  return (
    <Page
      title="Supplier–Part Links"
      primaryAction={{
        content: "Add Supplier Link",
        onAction: () => navigate("/supplier-parts/new"),
      }}
    >
      <Layout>
        <Layout.Section>
		<SupplierPartTable rows={parts} onDeleted={refresh} />
          <Card>
            {loading ? (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Spinner size="large" />
              </div>
            ) : (
              <SupplierPartTable rows={records} />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}