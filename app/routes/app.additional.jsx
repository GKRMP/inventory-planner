import { useState, useMemo } from "react";
import { useLoaderData, useRevalidator, useNavigate } from "react-router";
import {
  Page,
  Card,
  IndexTable,
  Button,
  Modal,
  TextField,
  Text,
  BlockStack,
  Select,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import AppNavigation from "../components/AppNavigation";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  console.log("Current scopes:", session.scope);

  const query = `
    {
      metaobjects(type: "supplier", first: 250) {
        edges {
          node {
            id
            handle
            fields {
              key
              value
            }
          }
        }
      }
    }
  `;

  const response = await admin.graphql(query);
  const data = await response.json();

  return {
    suppliers: data.data.metaobjects.edges.map(e => e.node),
  };
}

const US_STATES = [
  { label: "Select state...", value: "" },
  { label: "Alabama", value: "AL" },
  { label: "Alaska", value: "AK" },
  { label: "Arizona", value: "AZ" },
  { label: "Arkansas", value: "AR" },
  { label: "California", value: "CA" },
  { label: "Colorado", value: "CO" },
  { label: "Connecticut", value: "CT" },
  { label: "Delaware", value: "DE" },
  { label: "Florida", value: "FL" },
  { label: "Georgia", value: "GA" },
  { label: "Hawaii", value: "HI" },
  { label: "Idaho", value: "ID" },
  { label: "Illinois", value: "IL" },
  { label: "Indiana", value: "IN" },
  { label: "Iowa", value: "IA" },
  { label: "Kansas", value: "KS" },
  { label: "Kentucky", value: "KY" },
  { label: "Louisiana", value: "LA" },
  { label: "Maine", value: "ME" },
  { label: "Maryland", value: "MD" },
  { label: "Massachusetts", value: "MA" },
  { label: "Michigan", value: "MI" },
  { label: "Minnesota", value: "MN" },
  { label: "Mississippi", value: "MS" },
  { label: "Missouri", value: "MO" },
  { label: "Montana", value: "MT" },
  { label: "Nebraska", value: "NE" },
  { label: "Nevada", value: "NV" },
  { label: "New Hampshire", value: "NH" },
  { label: "New Jersey", value: "NJ" },
  { label: "New Mexico", value: "NM" },
  { label: "New York", value: "NY" },
  { label: "North Carolina", value: "NC" },
  { label: "North Dakota", value: "ND" },
  { label: "Ohio", value: "OH" },
  { label: "Oklahoma", value: "OK" },
  { label: "Oregon", value: "OR" },
  { label: "Pennsylvania", value: "PA" },
  { label: "Rhode Island", value: "RI" },
  { label: "South Carolina", value: "SC" },
  { label: "South Dakota", value: "SD" },
  { label: "Tennessee", value: "TN" },
  { label: "Texas", value: "TX" },
  { label: "Utah", value: "UT" },
  { label: "Vermont", value: "VT" },
  { label: "Virginia", value: "VA" },
  { label: "Washington", value: "WA" },
  { label: "West Virginia", value: "WV" },
  { label: "Wisconsin", value: "WI" },
  { label: "Wyoming", value: "WY" },
];

const COUNTRIES = [
  { label: "Select country...", value: "" },
  { label: "United States", value: "US" },
  { label: "Canada", value: "CA" },
  { label: "Mexico", value: "MX" },
  { label: "United Kingdom", value: "GB" },
  { label: "Australia", value: "AU" },
  { label: "China", value: "CN" },
  { label: "India", value: "IN" },
  { label: "Japan", value: "JP" },
  { label: "Germany", value: "DE" },
  { label: "France", value: "FR" },
  { label: "Italy", value: "IT" },
  { label: "Spain", value: "ES" },
  { label: "Brazil", value: "BR" },
  { label: "South Korea", value: "KR" },
  { label: "Vietnam", value: "VN" },
  { label: "Taiwan", value: "TW" },
  { label: "Thailand", value: "TH" },
  { label: "Indonesia", value: "ID" },
  { label: "Pakistan", value: "PK" },
  { label: "Bangladesh", value: "BD" },
];

export default function AdditionalPage() {
  const { suppliers } = useLoaderData();
  const revalidator = useRevalidator();
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [setupComplete, setSetupComplete] = useState(false);
  const [showSetupButton, setShowSetupButton] = useState(true);
  const [sortColumn, setSortColumn] = useState("supplier_id");
  const [sortDirection, setSortDirection] = useState("ascending");

  const openCreate = () => {
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
    // Auto-generate supplier ID if creating new and ID is empty
    const formData = { ...form };
    if (!editing && !formData.supplier_id) {
      formData.supplier_id = `SUP-${Date.now()}`;
    }

    const fields = Object.entries(formData)
      .filter(([key, value]) => value !== undefined && value !== null)
      .map(([key, value]) => ({ key, value: String(value) }));

    try {
      const response = await fetch("/api/suppliers", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          intent: editing ? "update" : "create",
          id: editing?.id || "",
          fields: JSON.stringify(fields),
        }),
      });

      const result = await response.json();

      const errors = result.data?.metaobjectCreate?.userErrors ||
                     result.data?.metaobjectUpdate?.userErrors || [];

      if (errors.length > 0) {
        console.error("Supplier save errors:", errors);
        alert(`Error saving supplier: ${errors.map(e => e.message).join(", ")}`);
        return;
      }

      setModalOpen(false);
      revalidator.revalidate();
    } catch (error) {
      console.error("Error saving supplier:", error);
    }
  };

  const remove = async (supplier) => {
    await fetch("/api/suppliers", {
      method: "POST",
      body: new URLSearchParams({
        intent: "delete",
        id: supplier.id,
      }),
    });

    revalidator.revalidate(); // Reload data from server
  };

  const setupSupplierDefinition = async () => {
    try {
      const response = await fetch("/api/setup-supplier-definition", {
        method: "POST",
      });
      const result = await response.json();

      // Check for errors in either create or update responses
      const createErrors = result.data?.metaobjectDefinitionCreate?.userErrors || [];
      const updateErrors = result.data?.metaobjectDefinitionUpdate?.userErrors || [];
      const errors = [...createErrors, ...updateErrors];

      if (errors.length > 0) {
        // Check if the error is that the definition already exists
        const alreadyExists = errors.some(e =>
          e.message.includes("already been taken") ||
          e.field?.includes("type")
        );

        if (alreadyExists) {
          alert("Supplier definition already exists! You can now add suppliers.");
          setSetupComplete(true);
          setShowSetupButton(false);
          revalidator.revalidate();
        } else {
          alert(`Setup errors: ${errors.map(e => e.message).join(", ")}`);
        }
      } else {
        alert("Supplier definition updated successfully! You can now add suppliers.");
        setSetupComplete(true);
        setShowSetupButton(false);
        revalidator.revalidate();
      }
    } catch (error) {
      console.error("Setup error:", error);
      alert("Error setting up supplier definition. Check console for details.");
    }
  };

  // Sort suppliers
  const sortedSuppliers = useMemo(() => {
    const sorted = [...suppliers];
    sorted.sort((a, b) => {
      const aVal = a.fields.find(f => f.key === sortColumn)?.value || "";
      const bVal = b.fields.find(f => f.key === sortColumn)?.value || "";

      return sortDirection === "ascending"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    });
    return sorted;
  }, [suppliers, sortColumn, sortDirection]);

  return (
    <>
      <TitleBar title="RMP Inventory Planner" />
      <Page
        fullWidth
        primaryAction={
          setupComplete
            ? {
                content: "Add Supplier",
                onAction: openCreate,
              }
            : undefined
        }
        secondaryActions={
          showSetupButton
            ? [
                {
                  content: "Setup Supplier Definition",
                  onAction: setupSupplierDefinition,
                },
              ]
            : undefined
        }
      >
        <BlockStack gap="400">
          <AppNavigation />
          <Card padding="0">
        <IndexTable
          resourceName={{ singular: "supplier", plural: "suppliers" }}
          itemCount={sortedSuppliers.length}
          headings={[
            { title: "Supplier ID" },
            { title: "Name" },
            { title: "Phone" },
            { title: "Email" },
            { title: "Actions" },
          ]}
          selectable={false}
          loading={revalidator.state === "loading"}
          sortable={[true, true, true, true, false]}
          sortDirection={sortDirection}
          sortColumnIndex={
            sortColumn === "supplier_id" ? 0 :
            sortColumn === "supplier_name" ? 1 :
            sortColumn === "phone_1" ? 2 :
            sortColumn === "email_1" ? 3 : undefined
          }
          onSort={(index) => {
            const columns = ["supplier_id", "supplier_name", "phone_1", "email_1"];
            const newColumn = columns[index];
            if (newColumn === sortColumn) {
              setSortDirection(sortDirection === "ascending" ? "descending" : "ascending");
            } else {
              setSortColumn(newColumn);
              setSortDirection("ascending");
            }
          }}
        >
          {sortedSuppliers.map((s, index) => (
            <IndexTable.Row id={s.id} key={s.id} position={index}>
              <IndexTable.Cell>
                <Text variant="bodyMd" fontWeight="semibold" as="span">
                  {s.fields.find((f) => f.key === "supplier_id")?.value || ""}
                </Text>
              </IndexTable.Cell>
              <IndexTable.Cell>
                {s.fields.find((f) => f.key === "supplier_name")?.value || ""}
              </IndexTable.Cell>
              <IndexTable.Cell>
                {s.fields.find((f) => f.key === "phone_1")?.value || ""}
              </IndexTable.Cell>
              <IndexTable.Cell>
                {s.fields.find((f) => f.key === "email_1")?.value || ""}
              </IndexTable.Cell>
              <IndexTable.Cell>
                <BlockStack gap="200" align="start">
                  <Button size="slim" onClick={() => openEdit(s)}>
                    Edit
                  </Button>
                  <Button size="slim" tone="critical" onClick={() => remove(s)}>
                    Delete
                  </Button>
                </BlockStack>
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
          </Card>
        </BlockStack>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editing ? "Edit Supplier" : "Create Supplier"}
          primaryAction={{ content: "Save", onAction: save }}
          size="large"
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="Supplier ID"
                value={form.supplier_id || ""}
                onChange={(v) => setForm({ ...form, supplier_id: v })}
                disabled={!!editing}
                required
                helpText={editing ? "ID cannot be changed" : "Auto-generated if left empty"}
              />
              <TextField
                label="Supplier Name"
                value={form.supplier_name || ""}
                onChange={(v) => setForm({ ...form, supplier_name: v })}
                required
              />
              <TextField
                label="Contact Name"
                value={form.contact_name || ""}
                onChange={(v) => setForm({ ...form, contact_name: v })}
              />
              <TextField
                label="Contact Name 2"
                value={form.contact_name_2 || ""}
                onChange={(v) => setForm({ ...form, contact_name_2: v })}
              />
              <TextField
                label="Address"
                value={form.address || ""}
                onChange={(v) => setForm({ ...form, address: v })}
              />
              <TextField
                label="Address 2"
                value={form.address_2 || ""}
                onChange={(v) => setForm({ ...form, address_2: v })}
              />
              <TextField
                label="City"
                value={form.city || ""}
                onChange={(v) => setForm({ ...form, city: v })}
              />
              <InlineStack gap="400" wrap={false}>
                <div style={{ flex: 1 }}>
                  <Select
                    label="State"
                    options={US_STATES}
                    value={form.state || ""}
                    onChange={(v) => setForm({ ...form, state: v })}
                  />
                </div>
                <div style={{ width: "120px" }}>
                  <TextField
                    label="ZIP"
                    value={form.zip || ""}
                    onChange={(v) => {
                      const digitsOnly = v.replace(/\D/g, "");
                      setForm({ ...form, zip: digitsOnly });
                    }}
                    maxLength={10}
                  />
                </div>
              </InlineStack>
              <Select
                label="Country"
                options={COUNTRIES}
                value={form.country || ""}
                onChange={(v) => setForm({ ...form, country: v })}
              />
              <TextField
                label="Phone"
                value={form.phone_1 || ""}
                onChange={(v) => setForm({ ...form, phone_1: v })}
                type="tel"
              />
              <TextField
                label="Phone 2"
                value={form.phone_2 || ""}
                onChange={(v) => setForm({ ...form, phone_2: v })}
                type="tel"
              />
              <TextField
                label="Email"
                value={form.email_1 || ""}
                onChange={(v) => setForm({ ...form, email_1: v })}
                type="email"
              />
              <TextField
                label="Email 2"
                value={form.email_2 || ""}
                onChange={(v) => setForm({ ...form, email_2: v })}
                type="email"
              />
              <TextField
                label="Website"
                value={form.website || ""}
                onChange={(v) => setForm({ ...form, website: v })}
                type="url"
                placeholder="https://"
              />
              <TextField
                label="Notes"
                value={form.notes || ""}
                onChange={(v) => setForm({ ...form, notes: v })}
                multiline={4}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
    </Page>
    </>
  );
}
