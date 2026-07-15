import { useState, useMemo, useCallback } from "react";
import { useRevalidator, useLoaderData } from "react-router";
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
  Checkbox,
  ChoiceList,
  Pagination,
  Badge,
} from "@shopify/polaris";

const SOURCING_TYPE_OPTIONS = [
  { label: "Resale", value: "resale" },
  { label: "NOS (New Old Stock)", value: "nos" },
  { label: "Repro (Reproduction)", value: "repro" },
];

const SOURCING_TYPE_BADGE = {
  nos: { tone: "info", label: "NOS" },
  repro: { tone: "attention", label: "Repro" },
  resale: { tone: "success", label: "Resale" },
};

function getSourcingType(variant) {
  const mf = variant.metafields.find(
    (m) => m.namespace === "inventory" && m.key === "sourcing_type"
  );
  return mf?.value || null;
}

function getReproSettings(variant) {
  const mf = variant.metafields.find(
    (m) => m.namespace === "inventory" && m.key === "repro_settings"
  );
  if (!mf) return null;
  try {
    return JSON.parse(mf.value);
  } catch {
    return null;
  }
}

// Same blend as app.dashboard.jsx's enrichVariant: recent order-history
// velocity weighted most heavily, used whenever no manual daily_demand
// override is set on the primary supplier source.
function getComputedDemand(variant) {
  if (!variant) return 0;
  return (
    0.5 * (variant.velocity30 || 0) + 0.3 * (variant.velocity90 || 0) + 0.2 * (variant.velocity365 || 0)
  );
}
import { TitleBar } from "@shopify/app-bridge-react";
import AppNavigation from "../components/AppNavigation";
import { loadCatalogForRoute } from "../services/catalog-queries.server";

export async function loader({ request }) {
  return loadCatalogForRoute(request);
}

export default function ProductsPage() {
  const { variants, suppliers } = useLoaderData();
  const revalidator = useRevalidator();
  const isLoading = revalidator.state === "loading";

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [suppliersList, setSuppliersList] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [form, setForm] = useState({
    supplier_id: "",
    mpn: "",
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

  // Sourcing type: per-variant modal
  const [sourcingModalOpen, setSourcingModalOpen] = useState(false);
  const [sourcingVariant, setSourcingVariant] = useState(null);
  const [sourcingForm, setSourcingForm] = useState({
    sourcing_type: "resale",
    run_size: "",
    moq: "",
    run_cost: "",
    tooling_notes: "",
  });
  const [sourcingSaving, setSourcingSaving] = useState(false);

  // Sourcing type: vendor bulk-set toolbar
  const [bulkVendor, setBulkVendor] = useState("all");
  const [bulkSourcingType, setBulkSourcingType] = useState("resale");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  // Client-side pagination
  const ITEMS_PER_PAGE = 50;
  const [currentPage, setCurrentPage] = useState(1);

  // Filter states
  const [statusFilter, setStatusFilter] = useState(["ACTIVE"]);

  // Client-side search filter
  const handleFiltersQueryChange = useCallback((value) => {
    setQueryValue(value);
    setCurrentPage(1);
  }, []);

  // Status filter change
  const handleStatusFilterChange = useCallback((value) => {
    setStatusFilter(value);
    setCurrentPage(1);
  }, []);

  const handleFiltersClearAll = useCallback(() => {
    setQueryValue("");
    setStatusFilter(["ACTIVE"]);
    setCurrentPage(1);
  }, []);

  const handleStatusFilterRemove = useCallback(() => {
    setStatusFilter(["ACTIVE"]);
    setCurrentPage(1);
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
      mpn: "",
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
      mpn: form.mpn,
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
      mpn: "",
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
      mpn: supplier.mpn || "",
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
      mpn: "",
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

  const openSourcingEdit = (variant) => {
    setSourcingVariant(variant);
    const repro = getReproSettings(variant) || {};
    setSourcingForm({
      sourcing_type: getSourcingType(variant) || "resale",
      run_size: repro.run_size?.toString() || "",
      moq: repro.moq?.toString() || "",
      run_cost: repro.run_cost?.toString() || "",
      tooling_notes: repro.tooling_notes || "",
    });
    setSourcingModalOpen(true);
  };

  const saveSourcing = async () => {
    if (!sourcingVariant) return;
    setSourcingSaving(true);
    try {
      await fetch("/api/sourcing-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId: sourcingVariant.id,
          sourcingType: sourcingForm.sourcing_type,
          reproSettings:
            sourcingForm.sourcing_type === "repro"
              ? {
                  run_size: parseInt(sourcingForm.run_size) || 0,
                  moq: parseInt(sourcingForm.moq) || 0,
                  run_cost: parseFloat(sourcingForm.run_cost) || 0,
                  tooling_notes: sourcingForm.tooling_notes,
                }
              : undefined,
        }),
      });
    } finally {
      setSourcingSaving(false);
      setSourcingModalOpen(false);
      setSourcingVariant(null);
      revalidator.revalidate();
    }
  };

  // Distinct vendors present in the catalog, for the bulk-set toolbar
  const vendorOptions = useMemo(() => {
    const vendors = new Set(variants.map((v) => v.vendor).filter(Boolean));
    return [
      { label: "All vendors", value: "all" },
      ...Array.from(vendors)
        .sort()
        .map((v) => ({ label: v, value: v })),
    ];
  }, [variants]);

  const applyBulkSourcing = async () => {
    const targets = variants.filter((v) => bulkVendor === "all" || v.vendor === bulkVendor);
    if (targets.length === 0) return;
    setBulkApplying(true);
    setBulkResult(null);
    try {
      const response = await fetch("/api/sourcing-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantIds: targets.map((v) => v.id),
          sourcingType: bulkSourcingType,
        }),
      });
      const result = await response.json();
      setBulkResult({
        count: result.success?.length || 0,
        failed: result.failed?.length || 0,
      });
      revalidator.revalidate();
    } catch (error) {
      setBulkResult({ count: 0, failed: targets.length, error: error.message });
    } finally {
      setBulkApplying(false);
    }
  };

  // Helper to get supplier name(s) from variant
  const getSupplierName = useCallback((variant) => {
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
  }, [suppliers]);

  const getSupplierNameById = (supplierId) => {
    const supplier = suppliers.find((s) =>
      s.fields.some((f) => f.key === "supplier_id" && f.value === supplierId)
    );
    return supplier
      ? supplier.fields.find((f) => f.key === "supplier_name")?.value || "Unknown"
      : "Unknown";
  };

  // Filter and sort ALL variants (full dataset)
  const filteredAndSortedVariants = useMemo(() => {
    let filtered = [...variants];

    // Apply status filter
    if (statusFilter.length > 0) {
      filtered = filtered.filter((v) => statusFilter.includes(v.productStatus));
    }

    // Apply client-side search query
    if (queryValue) {
      filtered = filtered.filter(
        (v) =>
          v.sku?.toLowerCase().includes(queryValue.toLowerCase()) ||
          v.productTitle?.toLowerCase().includes(queryValue.toLowerCase())
      );
    }

    // Sort by selected column
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
          return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
        case "supplier":
          aVal = getSupplierName(a);
          bVal = getSupplierName(b);
          return sortDirection === "ascending"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        default:
          return 0;
      }
    });

    return filtered;
  }, [variants, queryValue, statusFilter, sortColumn, sortDirection, getSupplierName]);

  // Client-side pagination
  const totalPages = Math.ceil(filteredAndSortedVariants.length / ITEMS_PER_PAGE);
  const paginatedVariants = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedVariants.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredAndSortedVariants, currentPage]);

  // Filter definitions for IndexFilters
  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Product Status"
          titleHidden
          choices={[
            { label: "Active", value: "ACTIVE" },
            { label: "Draft", value: "DRAFT" },
            { label: "Archived", value: "ARCHIVED" },
          ]}
          selected={statusFilter}
          onChange={handleStatusFilterChange}
        />
      ),
      shortcut: true,
    },
  ];

  // Applied filters for display
  const appliedFilters = [];
  if (statusFilter.length > 0 && !(statusFilter.length === 1 && statusFilter[0] === "ACTIVE")) {
    appliedFilters.push({
      key: "status",
      label: `Status: ${statusFilter.join(", ")}`,
      onRemove: handleStatusFilterRemove,
    });
  }

  return (
    <>
      <TitleBar title="RMP Inventory Planner" />
      <Page fullWidth>
        <BlockStack gap="400">
          <AppNavigation />

          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" as="h3">
                Bulk-set sourcing by vendor
              </Text>
              <InlineStack gap="300" blockAlign="end">
                <div style={{ minWidth: 220 }}>
                  <Select
                    label="Vendor"
                    options={vendorOptions}
                    value={bulkVendor}
                    onChange={(v) => {
                      setBulkVendor(v);
                      setBulkResult(null);
                    }}
                  />
                </div>
                <div style={{ minWidth: 220 }}>
                  <Select
                    label="Sourcing type"
                    options={SOURCING_TYPE_OPTIONS}
                    value={bulkSourcingType}
                    onChange={(v) => {
                      setBulkSourcingType(v);
                      setBulkResult(null);
                    }}
                  />
                </div>
                <Button onClick={applyBulkSourcing} loading={bulkApplying}>
                  Apply to{" "}
                  {
                    variants.filter((v) => bulkVendor === "all" || v.vendor === bulkVendor)
                      .length
                  }{" "}
                  variants
                </Button>
                {bulkResult && (
                  <Text variant="bodySm" tone={bulkResult.failed ? "critical" : "success"} as="span">
                    {bulkResult.error
                      ? `Failed: ${bulkResult.error}`
                      : `Updated ${bulkResult.count}${bulkResult.failed ? `, ${bulkResult.failed} failed` : ""}`}
                  </Text>
                )}
              </InlineStack>
            </BlockStack>
          </Card>

          <IndexFilters
            queryValue={queryValue}
            queryPlaceholder="Search by SKU or Product..."
            onQueryChange={handleFiltersQueryChange}
            onQueryClear={() => {
              setQueryValue("");
              setCurrentPage(1);
            }}
            filters={filters}
            appliedFilters={appliedFilters}
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
              itemCount={filteredAndSortedVariants.length}
              headings={[
                { title: "SKU" },
                { title: "Product" },
                { title: "Variant" },
                { title: "Status" },
                { title: "On Hand" },
                { title: "Supplier" },
                { title: "Sourcing" },
                { title: "Actions" },
              ]}
              selectable={false}
              loading={isLoading}
              sortable={[true, true, true, false, true, true, false, false]}
              sortDirection={sortDirection}
              sortColumnIndex={
                sortColumn === "sku" ? 0 :
                sortColumn === "product" ? 1 :
                sortColumn === "variant" ? 2 :
                sortColumn === "onHand" ? 4 :
                sortColumn === "supplier" ? 5 : undefined
              }
              onSort={(index) => {
                const columns = ["sku", "product", "variant", null, "onHand", "supplier"];
                const newColumn = columns[index];
                if (!newColumn) return;
                if (newColumn === sortColumn) {
                  setSortDirection(sortDirection === "ascending" ? "descending" : "ascending");
                } else {
                  setSortColumn(newColumn);
                  setSortDirection("ascending");
                }
                setCurrentPage(1);
              }}
            >
              {paginatedVariants.map((variant, index) => (
                <IndexTable.Row id={variant.id} key={variant.id} position={index}>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      {variant.sku || "N/A"}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{variant.productTitle}</IndexTable.Cell>
                  <IndexTable.Cell>{variant.variantTitle}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={variant.productStatus === "ACTIVE" ? "success" : variant.productStatus === "DRAFT" ? "warning" : "default"}>
                      {variant.productStatus}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{variant.inventoryQuantity}</IndexTable.Cell>
                  <IndexTable.Cell>{getSupplierName(variant)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {(() => {
                      const type = getSourcingType(variant);
                      const badge = type ? SOURCING_TYPE_BADGE[type] : null;
                      return badge ? (
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      ) : (
                        <Text variant="bodySm" tone="subdued" as="span">
                          Unclassified
                        </Text>
                      );
                    })()}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="200">
                      <Button size="slim" onClick={() => openEdit(variant)}>
                        Edit Supplier
                      </Button>
                      <Button size="slim" onClick={() => openSourcingEdit(variant)}>
                        Set Sourcing
                      </Button>
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>

          {/* Client-side Pagination */}
          {totalPages > 1 && (
            <InlineStack align="center" gap="400">
              <Text variant="bodySm" as="span" tone="subdued">
                Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredAndSortedVariants.length)} of {filteredAndSortedVariants.length} variants
              </Text>
              <Pagination
                hasPrevious={currentPage > 1}
                hasNext={currentPage < totalPages}
                onPrevious={() => setCurrentPage(currentPage - 1)}
                onNext={() => setCurrentPage(currentPage + 1)}
              />
            </InlineStack>
          )}

          {totalPages <= 1 && filteredAndSortedVariants.length > 0 && (
            <InlineStack align="center" gap="300">
              <Text variant="bodySm" as="span" tone="subdued">
                Showing {filteredAndSortedVariants.length} variants
              </Text>
            </InlineStack>
          )}
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
            {/* Product Section */}
            {selectedVariant && (
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">Product</Text>
                  <Text variant="bodyMd" as="p">
                    <Text as="span" fontWeight="semibold">Name:</Text> {selectedVariant.productTitle}
                  </Text>
                  <Text variant="bodyMd" as="p">
                    <Text as="span" fontWeight="semibold">SKU:</Text> {selectedVariant.sku || "N/A"}
                  </Text>
                  <Text variant="bodyMd" as="p">
                    <Text as="span" fontWeight="semibold">Variant:</Text> {selectedVariant.variantTitle}
                  </Text>
                  <Text variant="bodyMd" as="p">
                    <Text as="span" fontWeight="semibold">On Hand:</Text> {selectedVariant.inventoryQuantity}
                  </Text>
                </BlockStack>
              </Card>
            )}

            {/* Existing Suppliers Section - repeats for each supplier */}
            {suppliersList.length > 0 && suppliersList.map((sup, index) => (
              <Card key={index} background={sup.is_primary ? "bg-fill-success-secondary" : "bg-surface"}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h3">
                      {getSupplierNameById(sup.supplier_id)}
                      {sup.is_primary && " (Primary)"}
                    </Text>
                    <InlineStack gap="200">
                      <Button size="slim" onClick={() => editSupplier(index)}>
                        Edit
                      </Button>
                      <Button size="slim" tone="critical" onClick={() => removeSupplier(index)}>
                        Remove
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  {sup.mpn && (
                    <Text variant="bodySm" as="p">
                      <Text as="span" fontWeight="semibold">MPN:</Text> {sup.mpn}
                    </Text>
                  )}

                  <InlineStack gap="400" wrap={true}>
                    <Text variant="bodySm" as="span">
                      <Text as="span" fontWeight="semibold">Lead Time:</Text> {sup.lead_time} days
                    </Text>
                    <Text variant="bodySm" as="span">
                      <Text as="span" fontWeight="semibold">Threshold:</Text> {sup.threshold}
                    </Text>
                    <Text variant="bodySm" as="span">
                      <Text as="span" fontWeight="semibold">Daily Demand:</Text>{" "}
                      {sup.is_primary && !(parseFloat(sup.daily_demand) > 0)
                        ? `${getComputedDemand(selectedVariant).toFixed(2)} (computed)`
                        : sup.daily_demand}
                    </Text>
                  </InlineStack>

                  <InlineStack gap="400" wrap={true}>
                    <Text variant="bodySm" as="span">
                      <Text as="span" fontWeight="semibold">Last Order:</Text> {sup.last_order_date || "N/A"}
                    </Text>
                    <Text variant="bodySm" as="span">
                      <Text as="span" fontWeight="semibold">CPU:</Text> ${sup.last_order_cpu || 0}
                    </Text>
                    <Text variant="bodySm" as="span">
                      <Text as="span" fontWeight="semibold">Qty:</Text> {sup.last_order_quantity || 0}
                    </Text>
                  </InlineStack>

                  {sup.notes && (
                    <Text variant="bodySm" as="p" tone="subdued">
                      <Text as="span" fontWeight="semibold">Notes:</Text> {sup.notes}
                    </Text>
                  )}
                </BlockStack>
              </Card>
            ))}

            {/* Add/Edit Supplier Section */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">Supplier</Text>

                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <Select
                      label="Supplier"
                      options={supplierOptions}
                      value={form.supplier_id}
                      onChange={(v) => setForm({ ...form, supplier_id: v })}
                      required
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="MPN (Manufacturer Part Number)"
                      value={form.mpn}
                      onChange={(v) => setForm({ ...form, mpn: v })}
                      placeholder="Supplier's part number"
                    />
                  </div>
                </InlineStack>

                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Lead Time (days)"
                      type="number"
                      value={form.lead_time}
                      onChange={(v) => setForm({ ...form, lead_time: v })}
                      min="0"
                      helpText="Number of days to fulfill an order"
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
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Daily Demand"
                      type="number"
                      value={form.daily_demand}
                      onChange={(v) => setForm({ ...form, daily_demand: v })}
                      min="0"
                      step="0.01"
                      helpText={
                        parseFloat(form.daily_demand) > 0
                          ? `Manual override — computed from order history is ${getComputedDemand(selectedVariant).toFixed(2)}/day`
                          : `Average number sold per day — leave blank to use the computed value (${getComputedDemand(selectedVariant).toFixed(2)}/day from order history)`
                      }
                      connectedRight={
                        parseFloat(form.daily_demand) > 0 ? (
                          <Button size="slim" onClick={() => setForm({ ...form, daily_demand: "" })}>
                            Clear override
                          </Button>
                        ) : undefined
                      }
                    />
                  </div>
                </InlineStack>

                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Last Order Date"
                      type="date"
                      value={form.last_order_date}
                      onChange={(v) => setForm({ ...form, last_order_date: v })}
                    />
                  </div>
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

                <Checkbox
                  label="Set as Primary Supplier"
                  checked={form.is_primary}
                  onChange={(checked) => setForm({ ...form, is_primary: checked })}
                />

                <InlineStack gap="200">
                  <Button onClick={addSupplier} variant="primary">
                    {editingIndex !== null ? "Update Supplier" : "Add Supplier"}
                  </Button>
                  {editingIndex !== null && (
                    <Button onClick={() => {
                      setForm({
                        supplier_id: "",
                        mpn: "",
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
            </Card>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={sourcingModalOpen}
        onClose={() => {
          setSourcingModalOpen(false);
          setSourcingVariant(null);
        }}
        title="Set Sourcing Type"
        primaryAction={{ content: "Save", onAction: saveSourcing, loading: sourcingSaving }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {sourcingVariant && (
              <Card>
                <BlockStack gap="150">
                  <Text variant="bodyMd" as="p">
                    <Text as="span" fontWeight="semibold">Product:</Text>{" "}
                    {sourcingVariant.productTitle}
                  </Text>
                  <Text variant="bodyMd" as="p">
                    <Text as="span" fontWeight="semibold">SKU:</Text> {sourcingVariant.sku || "N/A"}
                  </Text>
                  <Text variant="bodyMd" as="p">
                    <Text as="span" fontWeight="semibold">On Hand:</Text>{" "}
                    {sourcingVariant.inventoryQuantity}
                  </Text>
                </BlockStack>
              </Card>
            )}

            <Select
              label="Sourcing Type"
              options={SOURCING_TYPE_OPTIONS}
              value={sourcingForm.sourcing_type}
              onChange={(v) => setSourcingForm({ ...sourcingForm, sourcing_type: v })}
            />

            {sourcingForm.sourcing_type === "repro" && (
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm" as="h3">Repro Settings</Text>
                  <InlineStack gap="400">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Run Size"
                        type="number"
                        value={sourcingForm.run_size}
                        onChange={(v) => setSourcingForm({ ...sourcingForm, run_size: v })}
                        min="0"
                        helpText="Units produced per production run"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="MOQ"
                        type="number"
                        value={sourcingForm.moq}
                        onChange={(v) => setSourcingForm({ ...sourcingForm, moq: v })}
                        min="0"
                        helpText="Minimum order quantity"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Run Cost ($)"
                        type="number"
                        value={sourcingForm.run_cost}
                        onChange={(v) => setSourcingForm({ ...sourcingForm, run_cost: v })}
                        min="0"
                        step="0.01"
                        prefix="$"
                        helpText="Flat cost to run one batch"
                      />
                    </div>
                  </InlineStack>
                  <TextField
                    label="Tooling Notes"
                    value={sourcingForm.tooling_notes}
                    onChange={(v) => setSourcingForm({ ...sourcingForm, tooling_notes: v })}
                    multiline={2}
                  />
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
    </>
  );
}
