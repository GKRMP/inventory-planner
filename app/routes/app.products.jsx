import { useState, useMemo, useCallback } from "react";
import { useLoaderData, useRevalidator, useFetcher } from "react-router";
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
  Divider,
  ChoiceList,
  Pagination,
  Badge,
  Banner,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import AppNavigation from "../components/AppNavigation";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    // Fetch first page of products quickly for initial display
    const productsQuery = `
      {
        products(first: 50, query: "status:ACTIVE") {
          pageInfo {
            hasNextPage
          }
          edges {
            node {
              id
              title
              status
              variants(first: 100) {
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

    if (productsData.errors) {
      console.error("Products GraphQL errors:", productsData.errors);
      return { variants: [], suppliers: [], hasMoreProducts: false };
    }

    if (!suppliersData.data || !suppliersData.data.metaobjects) {
      console.error("Suppliers response error:", suppliersData);
      return { variants: [], suppliers: [], hasMoreProducts: false };
    }

    // Transform data
    const variants = [];
    const productEdges = productsData.data?.products?.edges || [];
    productEdges.forEach((productEdge) => {
      const product = productEdge.node;
      product.variants.edges.forEach((variantEdge) => {
        const variant = variantEdge.node;
        variants.push({
          id: variant.id,
          sku: variant.sku,
          variantTitle: variant.title,
          productTitle: product.title,
          productStatus: product.status || "ACTIVE",
          inventoryQuantity: variant.inventoryQuantity || 0,
          metafields: variant.metafields.edges.map((m) => m.node),
        });
      });
    });

    const suppliers = suppliersData.data.metaobjects.edges.map((e) => e.node);
    const hasMoreProducts = productsData.data?.products?.pageInfo?.hasNextPage || false;

    return { variants, suppliers, hasMoreProducts };
  } catch (error) {
    console.error("Products loader error:", error);
    return { variants: [], suppliers: [], hasMoreProducts: false };
  }
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "loadAllProducts") {
    const statusFilter = formData.get("statusFilter") || "ACTIVE";

    // Fetch ALL products with pagination
    let allVariants = [];
    let hasNextPage = true;
    let cursor = null;
    let pageCount = 0;
    const maxPages = 50;

    // Build query filter
    const queryFilter = statusFilter ? `status:${statusFilter}` : "";

    while (hasNextPage && pageCount < maxPages) {
      try {
        const productsQuery = `
          query GetProducts($cursor: String, $query: String) {
            products(first: 250, after: $cursor, query: $query) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                  title
                  status
                  variants(first: 100) {
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

        const response = await admin.graphql(productsQuery, {
          variables: { cursor, query: queryFilter },
        });
        const data = await response.json();

        if (data.errors || !data.data?.products) {
          break;
        }

        data.data.products.edges.forEach((productEdge) => {
          const product = productEdge.node;
          product.variants.edges.forEach((variantEdge) => {
            const variant = variantEdge.node;
            allVariants.push({
              id: variant.id,
              sku: variant.sku,
              variantTitle: variant.title,
              productTitle: product.title,
              productStatus: product.status || "ACTIVE",
              inventoryQuantity: variant.inventoryQuantity || 0,
              metafields: variant.metafields.edges.map((m) => m.node),
            });
          });
        });

        hasNextPage = data.data.products.pageInfo.hasNextPage;
        cursor = data.data.products.pageInfo.endCursor;
        pageCount++;
      } catch (error) {
        console.error("Error fetching products page:", error);
        break;
      }
    }

    return { variants: allVariants, isComplete: true };
  }

  return { error: "Unknown intent" };
}

export default function ProductsPage() {
  const loaderData = useLoaderData();
  const revalidator = useRevalidator();
  const fetcher = useFetcher();

  // Use fetcher data if available (full data), otherwise use loader data (partial)
  const variants = fetcher.data?.variants || loaderData.variants;
  const suppliers = loaderData.suppliers;
  const isPartialData = fetcher.data?.isComplete ? false : loaderData.hasMoreProducts;
  const isLoading = fetcher.state === "submitting" || fetcher.state === "loading";

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

  // Client-side pagination
  const ITEMS_PER_PAGE = 50;
  const [currentPage, setCurrentPage] = useState(1);

  // Filter states
  const [statusFilter, setStatusFilter] = useState(["ACTIVE"]);

  // Load all products
  const loadAllData = useCallback(() => {
    const status = statusFilter.length > 0 ? statusFilter[0] : "ACTIVE";
    fetcher.submit({ intent: "loadAllProducts", statusFilter: status }, { method: "post" });
  }, [fetcher, statusFilter]);

  // Client-side search filter
  const handleFiltersQueryChange = useCallback((value) => {
    setQueryValue(value);
    setCurrentPage(1);
  }, []);

  // Status filter change - triggers reload of all products with new filter
  const handleStatusFilterChange = useCallback((value) => {
    setStatusFilter(value);
    setCurrentPage(1);
    // If we have complete data loaded, reload with new status filter
    if (fetcher.data?.isComplete) {
      const status = value.length > 0 ? value[0] : "ACTIVE";
      fetcher.submit({ intent: "loadAllProducts", statusFilter: status }, { method: "post" });
    }
  }, [fetcher]);

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

  // Filter and sort ALL variants (full dataset)
  const filteredAndSortedVariants = useMemo(() => {
    let filtered = [...variants];

    // Apply status filter (client-side when we have partial data)
    if (statusFilter.length > 0 && !fetcher.data?.isComplete) {
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
  }, [variants, queryValue, statusFilter, sortColumn, sortDirection, fetcher.data?.isComplete]);

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

          {isPartialData && !isLoading && (
            <Banner
              title="Showing partial data"
              tone="warning"
              action={{ content: "Load All Products", onAction: loadAllData }}
            >
              <p>Only showing the first 50 products. Click "Load All Products" to enable sorting and filtering across all products.</p>
            </Banner>
          )}

          {isLoading && (
            <Card>
              <BlockStack gap="200">
                <Text variant="bodyMd">Loading all products...</Text>
                <ProgressBar progress={75} tone="primary" />
              </BlockStack>
            </Card>
          )}

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
                { title: "Actions" },
              ]}
              selectable={false}
              loading={isLoading || revalidator.state === "loading"}
              sortable={[true, true, true, false, true, true, false]}
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
                    <Button size="slim" onClick={() => openEdit(variant)}>
                      Edit Supplier
                    </Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>

          {/* Client-side Pagination */}
          {totalPages > 1 && (
            <InlineStack align="center" gap="400">
              <Text variant="bodySm" as="span" tone="subdued">
                Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredAndSortedVariants.length)} of {filteredAndSortedVariants.length} variants{isPartialData ? "*" : ""}
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
            <InlineStack align="center">
              <Text variant="bodySm" as="span" tone="subdued">
                Showing {filteredAndSortedVariants.length} variants{isPartialData ? "*" : ""}
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
                      <Text as="span" fontWeight="semibold">Daily Demand:</Text> {sup.daily_demand}
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
                      helpText="Average number sold per day"
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
    </Page>
    </>
  );
}
