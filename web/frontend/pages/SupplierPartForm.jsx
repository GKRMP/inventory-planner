import { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Form,
  FormLayout,
  TextField,
  Button,
  Select,
} from "@shopify/polaris";
import { useNavigate, useParams } from "react-router-dom";
import VariantPicker from "../components/VariantPicker";

export default function SupplierPartForm() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [suppliers, setSuppliers] = useState([]);

  const [fields, setFields] = useState({
    product: "",
    sku: "",
    product_title: "",
    supplier: "",
    lead_time_days: "",
    threshold: "",
    last_order_date: "",
    last_order_cpu: "",
    last_order_quantity: "",
    notes: "",
  });

  // Load suppliers for dropdown
  useEffect(() => {
    async function loadSuppliers() {
      const res = await fetch("/api/suppliers");
      const data = await res.json();
      setSuppliers(data);
    }
    loadSuppliers();
  }, []);

  // Load existing supplier-part record if editing
  useEffect(() => {
    if (!id) return;

    async function loadRecord() {
      const res = await fetch("/api/supplier-parts");
      const data = await res.json();
      const record = data.find((r) => r.id === id);

      if (record) {
        setFields({
          product: record.product || "",
          sku: record.sku || "",
          product_title: record.product_title || "",
          supplier: record.supplier || "",
          lead_time_days: record.lead_time_days || "",
          threshold: record.threshold || "",
          last_order_date: record.last_order_date || "",
          last_order_cpu: record.last_order_cpu || "",
          last_order_quantity: record.last_order_quantity || "",
          notes: record.notes || "",
        });
      }
    }

    loadRecord();
  }, [id]);

  // Generic field handler
  const handleChange = (key) => (value) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  // Submit handler
  async function handleSubmit() {
    const method = id ? "PUT" : "POST";
    const url = id ? `/api/supplier-parts/${id}` : "/api/supplier-parts";

    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });

    navigate("/supplier-parts");
  }

  return (
    <Page
      title={id ? "Edit Supplier–Part Link" : "Add Supplier–Part Link"}
      breadcrumbs={[
        { content: "Supplier–Part Links", onAction: () => navigate("/supplier-parts") },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <Form onSubmit={handleSubmit}>
              <FormLayout>

                {/* VARIANT PICKER */}
                <VariantPicker
                  onSelect={({ variantId, sku, productTitle }) => {
                    setFields((prev) => ({
                      ...prev,
                      product: variantId,
                      sku,
                      product_title: productTitle,
                    }));
                  }}
                />

                {/* AUTO-FILLED FIELDS */}
                <TextField
                  label="Selected Variant ID"
                  value={fields.product}
                  disabled
                />

                <TextField
                  label="SKU"
                  value={fields.sku}
                  disabled
                />

                <TextField
                  label="Product Title"
                  value={fields.product_title}
                  disabled
                />

                {/* SUPPLIER DROPDOWN */}
                <Select
                  label="Supplier"
                  options={suppliers.map((s) => ({
                    label: s.supplier_name,
                    value: s.id,
                  }))}
                  value={fields.supplier}
                  onChange={handleChange("supplier")}
                />

                {/* LEAD TIME */}
                <TextField
                  label="Lead Time (Days)"
                  type="number"
                  value={fields.lead_time_days}
                  onChange={handleChange("lead_time_days")}
                />

                {/* THRESHOLD */}
                <TextField
                  label="Threshold"
                  type="number"
                  value={fields.threshold}
                  onChange={handleChange("threshold")}
                />

                {/* LAST ORDER FIELDS */}
                <TextField
                  label="Last Order Date"
                  type="date"
                  value={fields.last_order_date}
                  onChange={handleChange("last_order_date")}
                />

                <TextField
                  label="Last Order Cost Per Unit"
                  type="number"
                  value={fields.last_order_cpu}
                  onChange={handleChange("last_order_cpu")}
                />

                <TextField
                  label="Last Order Quantity"
                  type="number"
                  value={fields.last_order_quantity}
                  onChange={handleChange("last_order_quantity")}
                />

                {/* NOTES */}
                <TextField
                  label="Notes"
                  multiline={4}
                  value={fields.notes}
                  onChange={handleChange("notes")}
                />

                <Button submit primary>
                  Save
                </Button>

              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}