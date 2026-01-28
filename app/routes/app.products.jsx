import { useState, useMemo, useCallback } from "react";
import { useLoaderData, useRevalidator, useNavigate } from "react-router";
import {
  Page,
  Card,
  IndexTable,
  IndexFilters,
  IndexFiltersMode,
  useSetIndexFiltersMode,
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
  const { admin } = await authenticate.admin(request);

  // Fetch products with variants
  const productsQuery = `
    {
      products(first: 250) {
        edges {
          node {
            id
            title
            variants(first: 250) {
              edges {
                node {
                  id
                  sku
                  title
                  inventoryQuantity
                  metafields(first: 10) {
                    edges {
                      node {
                        id
                        namespace
                        key
                        value
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  // Fetch suppliers
  const suppliersQuery = `
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

  const [productsResponse, suppliersResponse] = await Promise.all([
    admin.graphql(productsQuery),
    admin.graphql(suppliersQuery),
  ]);

  const productsData = await productsResponse.json();
  const suppliersData = await suppliersResponse.json();

  // Transform data
  const variants = [];
  productsData.data.products.edges.forEach((productEdge) => {
    const product = productEdge.node;
    product.variants.edges.forEach((variantEdge) => {
      const variant = variantEdge.node;
      variants.push({
        id: variant.id,
        sku: variant.sku,
        variantTitle: variant.title,
        productTitle: product.title,
        inventoryQuantity: variant.inventoryQuantity || 0,
        metafields: variant.metafields.edges.map((m) => m.node),
      });
    });
  });

  const suppliers = suppliersData.data.metaobjects.edges.map((e) => e.node);

  return { variants, suppliers };
}

export default function ProductsPage() {
  const { variants, suppliers } = useLoaderData();
  const revalidator = useRevalidator();
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [suppliersList, setSuppliersList] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [form, setForm] = useState({
    supplier_id: "",
    lead_time: "",
    last_order_date: "",
    last_order_cpu: "",
    last_order_quantity: "",
    threshold: "",
    daily_demand: "",
    notes: "",
    is_primary: false,
  });

  const [queryValue, setQueryValue] = useState("");
  const [sortColumn, setSortColumn] = useState("sku");
  const [sortDirection, setSortDirection] = useState("ascending");
  const { mode, setMode } = useSetIndexFiltersMode(IndexFiltersMode.Filtering);

  const handleFiltersQueryChange = useCallback((value) => {
    setQueryValue(value);
  }, []);

  const handleFiltersClearAll = useCallback(() => {
    setQueryValue("");
  }, []);

  // Get supplier options for dropdown
  const supplierOptions = [
    { label: "Select a supplier", value: "" },
    ...suppliers.map((s) => ({
      label: s.fields.find((f) => f.key === "supplier_name")?.value || "Unnamed",
      value: s.fields.find((f) => f.key === "supplier_id")?.value || "",
    })),
  ];

  const openEdit = (variant) => {
    setSelectedVariant(variant);

    // Find existing supplier data metafield
    const supplierMetafield = variant.metafields.find(
      (m) => m.namespace === "inventory" && m.key === "supplier_data"
    );

    if (supplierMetafield) {
      try {
        const data = JSON.parse(supplierMetafield.value);
        // Check if data is array (new format) or object (old format)
        if (Array.isArray(data)) {
          setSuppliersList(data);
        } else {
          // Convert old single supplier format to new array format
          setSuppliersList([{ ...data, is_primary: true }]);
        }
      } catch (e) {
        setSuppliersList([]);
      }
    } else {
      setSuppliersList([]);
    }

    // Reset form
    setForm({
      supplier_id: "",
      lead_time: "",
      last_order_date: "",
      last_order_cpu: "",
      last_order_quantity: "",
      threshold: "",
      daily_demand: "",
      notes: "",
      is_primary: false,
    });
    setEditingIndex(null);
    setModalOpen(true);
  };

  const addSupplier = () => {
    if (!form.supplier_id) {
      alert("Please select a supplier");
      return;
    }

    const newSupplier = {
      supplier_id: form.supplier_id,
      lead_time: parseInt(form.lead_time) || 0,
      last_order_date: form.last_order_date,
      last_order_cpu: parseFloat(form.last_order_cpu) || 0,
      last_order_quantity: parseInt(form.last_order_quantity) || 0,
      threshold: parseInt(form.threshold) || 0,
      daily_demand: parseFloat(form.daily_demand) || 0,
      notes: form.notes,
      is_primary: form.is_primary || suppliersList.length === 0, // First supplier is always primary
    };

    if (editingIndex !== null) {
      // Update existing supplier
      const updated = [...suppliersList];
      updated[editingIndex] = newSupplier;
      setSuppliersList(updated);
    } else {
      // Add new supplier
      // If marking as primary, unmark others
      let updated = form.is_primary
        ? suppliersList.map(s => ({ ...s, is_primary: false }))
        : suppliersList;
      setSuppliersList([...updated, newSupplier]);
    }

    // Reset form
    setForm({
      supplier_id: "",
      lead_time: "",
      last_order_date: "",
      last_order_cpu: "",
      last_order_quantity: "",
      threshold: "",
      daily_demand: "",
      notes: "",
      is_primary: false,
    });
    setEditingIndex(null);
  };

  const editSupplier = (index) => {
    const supplier = suppliersList[index];
    setForm({
      supplier_id: supplier.supplier_id || "",
      lead_time: supplier.lead_time?.toString() || "",
      last_order_date: supplier.last_order_date || "",
      last_order_cpu: supplier.last_order_cpu?.toString() || "",
      last_order_quantity: supplier.last_order_quantity?.toString() || "",
      threshold: supplier.threshold?.toString() || "",
      daily_demand: supplier.daily_demand?.toString() || "",
      notes: supplier.notes || "",
      is_primary: supplier.is_primary || false,
    });
    setEditingIndex(index);
  };

  const removeSupplier = (index) => {
    const updated = suppliersList.filter((_, i) => i !== index);
    // If we removed the primary, make the first one primary
    if (updated.length > 0 && !updated.some(s => s.is_primary)) {
      updated[0].is_primary = true;
    }
    setSuppliersList(updated);
  };

  const save = async () => {
    if (!selectedVariant) return;

    if (suppliersList.length === 0) {
      alert("Please add at least one supplier");
      return;
    }

    // Save array of suppliers
    await fetch("/api/variant-supplier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variantId: selectedVariant.id,
        supplierData: JSON.stringify(suppliersList),
      }),
    });

    setModalOpen(false);
    setSelectedVariant(null);
    setSuppliersList([]);
    setForm({
      supplier_id: "",
      lead_time: "",
      last_order_date: "",
      last_order_cpu: "",
      last_order_quantity: "",
      threshold: "",
      daily_demand: "",
      notes: "",
      is_primary: false,
    });
    setEditingIndex(null);
    revalidator.revalidate();
  };

  // Helper to get supplier name(s) from variant
  const getSupplierName = (variant) => {
    const metafield = variant.metafields.find(
      (m) => m.namespace === "inventory" && m.key === "supplier_data"
    );
    if (!metafield) return "N/A";

    try {
      const data = JSON.parse(metafield.value);

      // Handle array format (multiple suppliers)
      if (Array.isArray(data)) {
        const names = data.map(supplierData => {
          const supplier = suppliers.find((s) =>
            s.fields.some((f) => f.key === "supplier_id" && f.value === supplierData.supplier_id)
          );
          const name = supplier
            ? supplier.fields.find((f) => f.key === "supplier_name")?.value || "Unknown"
            : "Unknown";
          return supplierData.is_primary ? `${name} (Primary)` : name;
        });
        return names.join(", ") || "N/A";
      }

      // Handle old single supplier format
      const supplier = suppliers.find((s) =>
        s.fields.some((f) => f.key === "supplier_id" && f.value === data.supplier_id)
      );
      return supplier
        ? supplier.fields.find((f) => f.key === "supplier_name")?.value || "N/A"
        : "N/A";
    } catch (e) {
      return "N/A";
    }
  };

  const getSupplierNameById = (supplierId) => {
    const supplier = suppliers.find((s) =>
      s.fields.some((f) => f.key === "supplier_id" && f.value === supplierId)
    );
    return supplier
      ? supplier.fields.find((f) => f.key === "supplier_name")?.value || "Unknown"
      : "Unknown";
  };

  // Filter and sort variants
  const filteredVariants = useMemo(() => {
    let filtered = queryValue
      ? variants.filter(
          (v) =>
            v.sku?.toLowerCase().includes(queryValue.toLowerCase()) ||
            v.productTitle?.toLowerCase().includes(queryValue.toLowerCase())
        )
      : variants;

    // Sort
    filtered.sort((a, b) => {
      let aVal, bVal;

      switch (sortColumn) {
        case "sku":
          aVal = a.sku || "";
          bVal = b.sku || "";
          return sortDirection === "ascending"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        case "product":
          aVal = a.productTitle || "";
          bVal = b.productTitle || "";
          return sortDirection === "ascending"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        case "variant":
          aVal = a.variantTitle || "";
          bVal = b.variantTitle || "";
          return sortDirection === "ascending"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        case "onHand":
          aVal = a.inventoryQuantity;
          bVal = b.inventoryQuantity;
          break;
        case "supplier":
          aVal = getSupplierName(a);
          bVal = getSupplierName(b);
          return sortDirection === "ascending"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        default:
          return 0;
      }

      return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
    });

    return filtered;
  }, [variants, queryValue, sortColumn, sortDirection]);

  return (
    <>
      <TitleBar title="RMP Inventory Planner" />
      <Page fullWidth>
        <BlockStack gap="400">
          <AppNavigation />
          <IndexFilters
            queryValue={queryValue}
            queryPlaceholder="Search by SKU or Product..."
            onQueryChange={handleFiltersQueryChange}
            onQueryClear={() => setQueryValue("")}
            filters={[]}
            appliedFilters={[]}
            onClearAll={handleFiltersClearAll}
            mode={mode}
            setMode={setMode}
            tabs={[]}
            selected={0}
            canCreateNewView={false}
          />
          <Card padding="0">
        <IndexTable
          resourceName={{ singular: "variant", plural: "variants" }}
          itemCount={filteredVariants.length}
          headings={[
            { title: "SKU" },
            { title: "Product" },
            { title: "Variant" },
            { title: "On Hand" },
            { title: "Supplier" },
            { title: "Actions" },
          ]}
          selectable={false}
          loading={revalidator.state === "loading"}
          sortable={[true, true, true, true, true, false]}
          sortDirection={sortDirection}
          sortColumnIndex={
            sortColumn === "sku" ? 0 :
            sortColumn === "product" ? 1 :
            sortColumn === "variant" ? 2 :
            sortColumn === "onHand" ? 3 :
            sortColumn === "supplier" ? 4 : undefined
          }
          onSort={(index) => {
            const columns = ["sku", "product", "variant", "onHand", "supplier"];
            const newColumn = columns[index];
            if (newColumn === sortColumn) {
              setSortDirection(sortDirection === "ascending" ? "descending" : "ascending");
            } else {
              setSortColumn(newColumn);
              setSortDirection("ascending");
            }
          }}
        >
          {filteredVariants.map((variant, index) => (
            <IndexTable.Row id={variant.id} key={variant.id} position={index}>
              <IndexTable.Cell>
                <Text variant="bodyMd" fontWeight="semibold" as="span">
                  {variant.sku || "N/A"}
                </Text>
              </IndexTable.Cell>
              <IndexTable.Cell>{variant.productTitle}</IndexTable.Cell>
              <IndexTable.Cell>{variant.variantTitle}</IndexTable.Cell>
              <IndexTable.Cell>{variant.inventoryQuantity}</IndexTable.Cell>
              <IndexTable.Cell>{getSupplierName(variant)}</IndexTable.Cell>
              <IndexTable.Cell>
                <Button size="slim" onClick={() => openEdit(variant)}>
                  Edit Supplier
                </Button>
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
          </Card>
        </BlockStack>

        <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSuppliersList([]);
          setEditingIndex(null);
        }}
        title="Manage Suppliers"
        primaryAction={{ content: "Save All", onAction: save }}
        size="large"
      >
        <Modal.Section>
          <BlockStack gap="400">
            {selectedVariant && (
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    {selectedVariant.productTitle}
                  </Text>
                  <Text variant="bodyMd" as="p">
                    SKU: {selectedVariant.sku || "N/A"}
                  </Text>
                  <Text variant="bodyMd" as="p">
                    Variant: {selectedVariant.variantTitle}
                  </Text>
                  <Text variant="bodyMd" as="p">
                    On Hand: {selectedVariant.inventoryQuantity}
                  </Text>
                </BlockStack>
              </Card>
            )}

            {suppliersList.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h3">
                    Current Suppliers ({suppliersList.length})
                  </Text>
                  {suppliersList.map((sup, index) => (
                    <Card key={index} background={sup.is_primary ? "bg-fill-success-secondary" : "bg-surface"}>
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text variant="bodyMd" fontWeight="semibold">
                            {getSupplierNameById(sup.supplier_id)}
                            {sup.is_primary && " (Primary)"}
                          </Text>
                          <Text variant="bodySm" tone="subdued">
                            Lead Time: {sup.lead_time} days | Threshold: {sup.threshold} | Daily Demand: {sup.daily_demand}
                          </Text>
                        </BlockStack>
                        <InlineStack gap="200">
                          <Button size="slim" onClick={() => editSupplier(index)}>
                            Edit
                          </Button>
                          <Button size="slim" tone="critical" onClick={() => removeSupplier(index)}>
                            Remove
                          </Button>
                        </InlineStack>
                      </InlineStack>
                    </Card>
                  ))}
                </BlockStack>
              </Card>
            )}

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">
                  {editingIndex !== null ? "Edit Supplier" : "Add Supplier"}
                </Text>
              </BlockStack>
            </Card>

            <Select
              label="Supplier"
              options={supplierOptions}
              value={form.supplier_id}
              onChange={(v) => setForm({ ...form, supplier_id: v })}
              required
            />

            <InlineStack gap="400">
              <div style={{ flex: 1 }}>
                <TextField
                  label="Lead Time (days)"
                  type="number"
                  value={form.lead_time}
                  onChange={(v) => setForm({ ...form, lead_time: v })}
                  min="0"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Threshold (min stock)"
                  type="number"
                  value={form.threshold}
                  onChange={(v) => setForm({ ...form, threshold: v })}
                  min="0"
                  helpText="Minimum quantity to keep in stock"
                />
              </div>
            </InlineStack>

            <TextField
              label="Daily Demand"
              type="number"
              value={form.daily_demand}
              onChange={(v) => setForm({ ...form, daily_demand: v })}
              min="0"
              step="0.01"
              helpText="Average number sold per day"
            />

            <TextField
              label="Last Order Date"
              type="date"
              value={form.last_order_date}
              onChange={(v) => setForm({ ...form, last_order_date: v })}
            />

            <InlineStack gap="400">
              <div style={{ flex: 1 }}>
                <TextField
                  label="Last Order Cost Per Unit ($)"
                  type="number"
                  value={form.last_order_cpu}
                  onChange={(v) => setForm({ ...form, last_order_cpu: v })}
                  min="0"
                  step="0.01"
                  prefix="$"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Last Order Quantity"
                  type="number"
                  value={form.last_order_quantity}
                  onChange={(v) => setForm({ ...form, last_order_quantity: v })}
                  min="0"
                />
              </div>
            </InlineStack>

            <TextField
              label="Notes"
              value={form.notes}
              onChange={(v) => setForm({ ...form, notes: v })}
              multiline={3}
            />

            <InlineStack align="start">
              <input
                type="checkbox"
                checked={form.is_primary}
                onChange={(e) => setForm({ ...form, is_primary: e.target.checked })}
                style={{ marginRight: "8px", marginTop: "2px" }}
              />
              <Text variant="bodyMd" as="span">
                Set as Primary Supplier
              </Text>
            </InlineStack>

            <InlineStack gap="200">
              <Button onClick={addSupplier} variant="primary">
                {editingIndex !== null ? "Update Supplier" : "Add Supplier"}
              </Button>
              {editingIndex !== null && (
                <Button onClick={() => {
                  setForm({
                    supplier_id: "",
                    lead_time: "",
                    last_order_date: "",
                    last_order_cpu: "",
                    last_order_quantity: "",
                    threshold: "",
                    daily_demand: "",
                    notes: "",
                    is_primary: false,
                  });
                  setEditingIndex(null);
                }}>
                  Cancel Edit
                </Button>
              )}
            </InlineStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
    </>
  );
}
