import { useEffect, useState } from "react";
import {
  Page,
  Card,
  DataTable,
  Button,
  Modal,
  TextField,
} from "@shopify/polaris";

export default function AdditionalPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});

  const loadSuppliers = async () => {
    setLoading(true);
    const res = await fetch("/api/suppliers");
    const data = await res.json();
    setSuppliers(data.suppliers);
    setLoading(false);
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

const openCreate = () => {
  console.log("OPEN CREATE CLICKED");   // diagnostic
  setEditing(null);
  setForm({});
  setModalOpen(true);
};

  const openEdit = (supplier) => {
    setEditing(supplier);
    const obj = {};
    supplier.fields.forEach((f) => (obj[f.key] = f.value));
    setForm(obj);
    setModalOpen(true);
  };

  const save = async () => {
    const fields = Object.entries(form).map(([key, value]) => ({ key, value }));

    await fetch("/api/suppliers", {
      method: "POST",
      body: new URLSearchParams({
        intent: editing ? "update" : "create",
        id: editing?.id,
        fields: JSON.stringify(fields),
      }),
    });

    setModalOpen(false);
    loadSuppliers();
  };

  const remove = async (supplier) => {
    await fetch("/api/suppliers", {
      method: "POST",
      body: new URLSearchParams({
        intent: "delete",
        id: supplier.id,
      }),
    });

    loadSuppliers();
  };

  const rows = suppliers.map((s) => [
    s.fields.find((f) => f.key === "supplier_name")?.value || "",
    s.fields.find((f) => f.key === "phone_1")?.value || "",
    s.fields.find((f) => f.key === "email_1")?.value || "",
    <Button onClick={() => openEdit(s)}>Edit</Button>,
    <Button tone="critical" onClick={() => remove(s)}>Delete</Button>,
  ]);

  return (
      <Page title="Suppliers">
        <Card>
          <Button primary onClick={openCreate}>
            Add Supplier
          </Button>
          <DataTable
            columnContentTypes={["text", "text", "text", "text", "text"]}
            headings={["Name", "Phone", "Email", "Edit", "Delete"]}
            rows={rows}
            loading={loading}
          />
        </Card>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editing ? "Edit Supplier" : "Create Supplier"}
          primaryAction={{ content: "Save", onAction: save }}
        >
          <Modal.Section>
            <TextField
              label="Supplier Name"
              value={form.supplier_name || ""}
              onChange={(v) => setForm({ ...form, supplier_name: v })}
            />
            <TextField
              label="Phone"
              value={form.phone_1 || ""}
              onChange={(v) => setForm({ ...form, phone_1: v })}
            />
            <TextField
              label="Email"
              value={form.email_1 || ""}
              onChange={(v) => setForm({ ...form, email_1: v })}
            />
          </Modal.Section>
        </Modal>
      </Page>
  );
}