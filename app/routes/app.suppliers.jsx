import { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Button,
  IndexTable,
  Text,
  InlineStack,
  Modal,
  TextField,
  Spinner,
} from "@shopify/polaris";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const [form, setForm] = useState({
    name: "",
    contactName: "",
    phone: "",
    email: "",
    website: "",
    notes: "",
  });

  async function loadSuppliers() {
    setLoading(true);
    const res = await fetch("/api/suppliers");
    const data = await res.json();
    setSuppliers(data);
    setLoading(false);
  }

  async function createSupplier() {
    await fetch("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setModalOpen(false);
    setForm({
      name: "",
      contactName: "",
      phone: "",
      email: "",
      website: "",
      notes: "",
    });

    loadSuppliers();
  }

  useEffect(() => {
    loadSuppliers();
  }, []);

  return (
    <Page
      title="Suppliers"
      primaryAction={{
        content: "Add Supplier",
        onAction: () => setModalOpen(true),
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            {loading ? (
              <InlineStack align="center" blockAlign="center">
                <Spinner />
              </InlineStack>
            ) : (
              <IndexTable
                resourceName={{ singular: "supplier", plural: "suppliers" }}
                itemCount={suppliers.length}
                headings={[
                  { title: "Name" },
                  { title: "Contact" },
                  { title: "Phone" },
                  { title: "Email" },
                  { title: "Website" },
                ]}
              >
                {suppliers.map((s, index) => (
                  <IndexTable.Row id={s.id} key={s.id} position={index}>
                    <IndexTable.Cell>
                      <Text>{s.name}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{s.contactName}</IndexTable.Cell>
                    <IndexTable.Cell>{s.phone}</IndexTable.Cell>
                    <IndexTable.Cell>{s.email}</IndexTable.Cell>
                    <IndexTable.Cell>{s.website}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add Supplier"
        primaryAction={{
          content: "Save",
          onAction: createSupplier,
        }}
      >
        <Modal.Section>
          <TextField
            label="Supplier Name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
          />
          <TextField
            label="Contact Name"
            value={form.contactName}
            onChange={(v) => setForm({ ...form, contactName: v })}
          />
          <TextField
            label="Phone"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
          />
          <TextField
            label="Email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
          />
          <TextField
            label="Website"
            value={form.website}
            onChange={(v) => setForm({ ...form, website: v })}
          />
          <TextField
            label="Notes"
            multiline={4}
            value={form.notes}
            onChange={(v) => setForm({ ...form, notes: v })}
          />
        </Modal.Section>
      </Modal>
    </Page>
  );
}