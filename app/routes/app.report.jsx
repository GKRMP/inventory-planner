import { useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Card,
  IndexTable,
  IndexFilters,
  useSetIndexFiltersMode,
  Text,
  Badge,
  BlockStack,
  ChoiceList,
  InlineStack,
  Pagination,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useState, useMemo, useCallback } from "react";
import AppNavigation from "../components/AppNavigation";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    // Get URL params for pagination
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const direction = url.searchParams.get("direction") || "forward";
    const riskFilter = url.searchParams.get("risk") || "";

    // Fetch one page of products (50 products at a time for speed)
    const productsQuery = direction === "backward" ? `
      query GetProducts($cursor: String) {
        products(last: 50, before: $cursor, query: "status:ACTIVE") {
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
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
    ` : `
      query GetProducts($cursor: String) {
        products(first: 50, after: $cursor, query: "status:ACTIVE") {
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
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

    // Fetch all suppliers
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
      admin.graphql(productsQuery, {
        variables: { cursor },
      }),
      admin.graphql(suppliersQuery),
    ]);

    const productsData = await productsResponse.json();
    const suppliersData = await suppliersResponse.json();

    if (productsData.errors) {
      console.error("Products GraphQL errors:", productsData.errors);
      return { variants: [], suppliers: [], pageInfo: null, currentRisk: riskFilter };
    }

    if (!suppliersData.data || !suppliersData.data.metaobjects) {
      console.error("Suppliers response error:", suppliersData);
      return { variants: [], suppliers: [], pageInfo: null, currentRisk: riskFilter };
    }

    // Transform data for easier use
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
          inventoryQuantity: variant.inventoryQuantity || 0,
          metafields: variant.metafields.edges.map((m) => m.node),
        });
      });
    });

    const suppliers = suppliersData.data.metaobjects.edges.map((e) => e.node);
    const pageInfo = productsData.data?.products?.pageInfo || null;

    return { variants, suppliers, pageInfo, currentRisk: riskFilter };
  } catch (error) {
    console.error("Report loader error:", error);
    return { variants: [], suppliers: [], pageInfo: null, currentRisk: "" };
  }
}

// Helper function to get metafield value
function getMetafieldValue(metafields, namespace, key) {
  const metafield = metafields.find(
    (m) => m.namespace === namespace && m.key === key
  );
  return metafield ? metafield.value : null;
}

// Calculate inventory metrics
function calculateMetrics(variant, suppliers) {
  const supplierData = getMetafieldValue(
    variant.metafields,
    "inventory",
    "supplier_data"
  );

  let dailyDemand = 0;
  let threshold = 0;
  let leadTime = 0;
  let supplierName = "";

  if (supplierData) {
    try {
      const parsed = JSON.parse(supplierData);

      // Handle array format (multiple suppliers) - use primary supplier
      if (Array.isArray(parsed)) {
        const primarySupplier = parsed.find(s => s.is_primary) || parsed[0];
        if (primarySupplier) {
          dailyDemand = parseFloat(primarySupplier.daily_demand) || 0;
          threshold = parseInt(primarySupplier.threshold) || 0;
          leadTime = parseInt(primarySupplier.lead_time) || 0;

          // Find supplier name
          const supplier = suppliers.find((s) =>
            s.fields.some((f) => f.key === "supplier_id" && f.value === primarySupplier.supplier_id)
          );
          if (supplier) {
            supplierName = supplier.fields.find((f) => f.key === "supplier_name")?.value || "";
          }

          // Add count of suppliers if multiple
          if (parsed.length > 1) {
            supplierName += ` (+${parsed.length - 1} more)`;
          }
        }
      } else {
        // Handle old single supplier format
        dailyDemand = parseFloat(parsed.daily_demand) || 0;
        threshold = parseInt(parsed.threshold) || 0;
        leadTime = parseInt(parsed.lead_time) || 0;

        // Find supplier name
        const supplier = suppliers.find((s) =>
          s.fields.some((f) => f.key === "supplier_id" && f.value === parsed.supplier_id)
        );
        if (supplier) {
          supplierName = supplier.fields.find((f) => f.key === "supplier_name")?.value || "";
        }
      }
    } catch (e) {
      // Invalid JSON
    }
  }

  const onHand = variant.inventoryQuantity;
  const annualizedDemand = dailyDemand * 365;
  const daysUntilStockout = dailyDemand > 0 ? Math.floor((onHand - threshold) / dailyDemand) : 999;
  const stockoutDate = new Date();
  stockoutDate.setDate(stockoutDate.getDate() + daysUntilStockout);

  const reorderPoint = threshold + (dailyDemand * leadTime);
  const suggestedOrderSize = Math.max(0, (dailyDemand * leadTime * 2) - onHand);

  // Calculate risk level
  let riskLevel = "low";
  let riskColor = "success";
  if (daysUntilStockout < 0) {
    riskLevel = "out_of_stock";
    riskColor = "critical";
  } else if (daysUntilStockout <= 7) {
    riskLevel = "critical";
    riskColor = "critical";
  } else if (daysUntilStockout <= 14) {
    riskLevel = "warning";
    riskColor = "warning";
  } else if (daysUntilStockout <= 30) {
    riskLevel = "attention";
    riskColor = "attention";
  }

  return {
    dailyDemand,
    threshold,
    leadTime,
    supplierName,
    annualizedDemand,
    daysUntilStockout,
    stockoutDate,
    reorderPoint,
    suggestedOrderSize,
    riskLevel,
    riskColor,
  };
}

export default function Report() {
  const { variants, suppliers, pageInfo, currentRisk } = useLoaderData();
  const navigate = useNavigate();
  const [queryValue, setQueryValue] = useState("");
  const [riskFilter, setRiskFilter] = useState(currentRisk ? [currentRisk] : []);
  const [selectedTab, setSelectedTab] = useState(0);
  const [sortedColumn, setSortedColumn] = useState("daysUntilStockout");
  const [sortDirection, setSortDirection] = useState("ascending");
  const { mode, setMode } = useSetIndexFiltersMode();

  // Define tabs for risk levels
  const tabs = [
    { id: "all", content: "All", riskValue: null },
    { id: "out_of_stock", content: "Out of Stock", riskValue: "out_of_stock" },
    { id: "critical", content: "Critical", riskValue: "critical" },
    { id: "warning", content: "Warning", riskValue: "warning" },
    { id: "attention", content: "Attention", riskValue: "attention" },
    { id: "low", content: "Low Risk", riskValue: "low" },
  ];

  const handleTabChange = useCallback((index) => {
    setSelectedTab(index);
    const tab = tabs[index];
    if (tab.riskValue) {
      setRiskFilter([tab.riskValue]);
    } else {
      setRiskFilter([]);
    }
  }, []);

  // Server-side pagination handlers
  const handleNextPage = useCallback(() => {
    if (pageInfo?.hasNextPage && pageInfo?.endCursor) {
      const risk = riskFilter.length > 0 ? riskFilter[0] : "";
      const params = new URLSearchParams();
      params.set("cursor", pageInfo.endCursor);
      params.set("direction", "forward");
      if (risk) params.set("risk", risk);
      navigate(`/app/report?${params.toString()}`);
    }
  }, [pageInfo, riskFilter, navigate]);

  const handlePreviousPage = useCallback(() => {
    if (pageInfo?.hasPreviousPage && pageInfo?.startCursor) {
      const risk = riskFilter.length > 0 ? riskFilter[0] : "";
      const params = new URLSearchParams();
      params.set("cursor", pageInfo.startCursor);
      params.set("direction", "backward");
      if (risk) params.set("risk", risk);
      navigate(`/app/report?${params.toString()}`);
    }
  }, [pageInfo, riskFilter, navigate]);

  // Calculate metrics for all variants
  const variantsWithMetrics = useMemo(() => {
    return variants.map((variant) => ({
      ...variant,
      metrics: calculateMetrics(variant, suppliers),
    }));
  }, [variants, suppliers]);

  // Filter and sort (client-side on current page)
  const displayedVariants = useMemo(() => {
    let filtered = variantsWithMetrics;

    // Search filter (client-side)
    if (queryValue) {
      filtered = filtered.filter(
        (v) =>
          v.sku?.toLowerCase().includes(queryValue.toLowerCase()) ||
          v.productTitle?.toLowerCase().includes(queryValue.toLowerCase())
      );
    }

    // Risk filter (client-side on current page)
    if (riskFilter.length > 0) {
      filtered = filtered.filter((v) => riskFilter.includes(v.metrics.riskLevel));
    }

    // Sort based on selected column
    filtered.sort((a, b) => {
      let aVal, bVal;

      switch (sortedColumn) {
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
        case "onHand":
          aVal = a.inventoryQuantity;
          bVal = b.inventoryQuantity;
          return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
        case "dailyDemand":
          aVal = a.metrics.dailyDemand;
          bVal = b.metrics.dailyDemand;
          return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
        case "threshold":
          aVal = a.metrics.threshold;
          bVal = b.metrics.threshold;
          return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
        case "supplier":
          aVal = a.metrics.supplierName || "";
          bVal = b.metrics.supplierName || "";
          return sortDirection === "ascending"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        case "leadTime":
          aVal = a.metrics.leadTime;
          bVal = b.metrics.leadTime;
          return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
        case "annualDemand":
          aVal = a.metrics.annualizedDemand;
          bVal = b.metrics.annualizedDemand;
          return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
        case "daysUntilStockout":
          aVal = a.metrics.daysUntilStockout;
          bVal = b.metrics.daysUntilStockout;
          return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
        case "reorderPoint":
          aVal = a.metrics.reorderPoint;
          bVal = b.metrics.reorderPoint;
          return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
        case "suggestedOrder":
          aVal = a.metrics.suggestedOrderSize;
          bVal = b.metrics.suggestedOrderSize;
          return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
        default:
          aVal = a.metrics.daysUntilStockout;
          bVal = b.metrics.daysUntilStockout;
          return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
      }
    });

    return filtered;
  }, [variantsWithMetrics, queryValue, riskFilter, sortedColumn, sortDirection]);

  const handleSort = useCallback((index, direction) => {
    const columnMap = [
      "risk", "sku", "product", "onHand", "dailyDemand", "threshold",
      "supplier", "leadTime", "annualDemand", "daysUntilStockout",
      "stockoutDate", "reorderPoint", "suggestedOrder"
    ];
    setSortedColumn(columnMap[index]);
    setSortDirection(direction);
  }, []);

  const handleFiltersQueryChange = useCallback((value) => {
    setQueryValue(value);
  }, []);

  const handleFiltersClearAll = useCallback(() => {
    setQueryValue("");
    setRiskFilter([]);
  }, []);

  const handleRiskFilterChange = useCallback((value) => {
    setRiskFilter(value);
  }, []);

  const handleRiskFilterRemove = useCallback(() => {
    setRiskFilter([]);
  }, []);

  const filters = [
    {
      key: "riskLevel",
      label: "Risk Level",
      filter: (
        <ChoiceList
          title="Risk Level"
          titleHidden
          choices={[
            { label: "Out of Stock", value: "out_of_stock" },
            { label: "Critical", value: "critical" },
            { label: "Warning", value: "warning" },
            { label: "Attention", value: "attention" },
            { label: "Low Risk", value: "low" },
          ]}
          selected={riskFilter}
          onChange={handleRiskFilterChange}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = [];
  if (riskFilter.length > 0) {
    const riskLabels = {
      out_of_stock: "Out of Stock",
      critical: "Critical",
      warning: "Warning",
      attention: "Attention",
      low: "Low Risk",
    };
    appliedFilters.push({
      key: "riskLevel",
      label: `Risk: ${riskFilter.map(r => riskLabels[r]).join(", ")}`,
      onRemove: handleRiskFilterRemove,
    });
  }

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
            filters={filters}
            appliedFilters={appliedFilters}
            onClearAll={handleFiltersClearAll}
            mode={mode}
            setMode={setMode}
            tabs={tabs}
            selected={selectedTab}
            onSelect={handleTabChange}
            canCreateNewView={false}
          />
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={displayedVariants.length}
              headings={[
                { title: "Risk" },
                { title: "SKU" },
                { title: "Product" },
                { title: "On Hand" },
                { title: "Daily Demand" },
                { title: "Threshold" },
                { title: "Supplier" },
                { title: "Lead Time" },
                { title: "Annual Demand" },
                { title: "Days to Stockout" },
                { title: "Stockout Date" },
                { title: "Reorder Point" },
                { title: "Suggested Order" },
              ]}
              selectable={false}
              sortable={[false, true, true, true, true, true, true, true, true, true, false, true, true]}
              sortDirection={sortDirection}
              sortColumnIndex={
                ["risk", "sku", "product", "onHand", "dailyDemand", "threshold",
                 "supplier", "leadTime", "annualDemand", "daysUntilStockout",
                 "stockoutDate", "reorderPoint", "suggestedOrder"].indexOf(sortedColumn)
              }
              onSort={handleSort}
            >
              {displayedVariants.map((variant, index) => (
                <IndexTable.Row id={variant.id} key={variant.id} position={index}>
                  <IndexTable.Cell>
                    <Badge tone={variant.metrics.riskColor}>
                      {variant.metrics.riskLevel.split("_").join(" ").toUpperCase()}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      {variant.sku || "N/A"}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{variant.productTitle}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" as="span">
                      {variant.inventoryQuantity}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {variant.metrics.dailyDemand.toFixed(2)}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{variant.metrics.threshold}</IndexTable.Cell>
                  <IndexTable.Cell>{variant.metrics.supplierName || "N/A"}</IndexTable.Cell>
                  <IndexTable.Cell>{variant.metrics.leadTime} days</IndexTable.Cell>
                  <IndexTable.Cell>
                    {Math.round(variant.metrics.annualizedDemand)}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {variant.metrics.daysUntilStockout >= 0
                      ? variant.metrics.daysUntilStockout
                      : "OUT"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {variant.metrics.stockoutDate.toLocaleDateString()}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {Math.round(variant.metrics.reorderPoint)}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      {Math.round(variant.metrics.suggestedOrderSize)}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>

          {/* Server-side Pagination */}
          {pageInfo && (pageInfo.hasPreviousPage || pageInfo.hasNextPage) && (
            <InlineStack align="center" gap="400">
              <Text variant="bodySm" as="span" tone="subdued">
                Showing {displayedVariants.length} variants on this page
              </Text>
              <Pagination
                hasPrevious={pageInfo.hasPreviousPage}
                hasNext={pageInfo.hasNextPage}
                onPrevious={handlePreviousPage}
                onNext={handleNextPage}
              />
            </InlineStack>
          )}
        </BlockStack>
      </Page>
    </>
  );
}
