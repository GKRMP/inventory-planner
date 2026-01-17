import { useEffect, useState } from "react";
import { Page, Layout, Card, Form, FormLayout, TextField, Button } from "@shopify/polaris";
import { useNavigate, useParams } from "react-router-dom";

export default function SupplierForm() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [fields, setFields] = useState({
    supplier_id: "",
    supplier_name: "",
    contact_name_1: "",
    contact_name_2: "",
    address_1: "",
    address_2: "",
    city: "",
    zip: "",
    country: "",
    phone_1: "",
    phone_2: "",
    email_1: "",
    email_2: "",
    website: "",
    notes: "",
  });

  useEffect(() => {
    if (!id) return;
    async function loadSupplier() {
      const res = await fetch("/api/suppliers");
      const data = await res.json();
      const supplier = data.find((s) => s.id === id);
      if (supplier) setFields(supplier);
    }
    loadSupplier();
  }, [id]);

  const handleChange = (key) => (value) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  async function handleSubmit() {
    const method = id ? "PUT" : "POST";
    const url = id ? `/api/suppliers/${id}` : "/api/suppliers";

    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });

    navigate("/suppliers");
  }

  return (
    <Page
      title={id ? "Edit Supplier" : "Add Supplier"}
      breadcrumbs={[{ content: "Suppliers", onAction: () => navigate("/suppliers") }]}
    >
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <Form onSubmit={handleSubmit}>
              <FormLayout>
                {Object.keys(fields).map((key) => (
                  <TextField
                    key={key}
                    label={key.replace(/_/g, " ")}
                    value={fields[key]}
                    onChange={handleChange(key)}
                  />
                ))}

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