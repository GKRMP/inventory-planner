import { useMemo, useState, useCallback } from "react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import {
  Page,
  Card,
  IndexTable,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import AppNavigation from "../components/AppNavigation";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  // Fetch all suppliers - this is quick
  let suppliers = [];
  try {
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

    const suppliersResponse = await admin.graphql(suppliersQuery);
    const suppliersData = await suppliersResponse.json();

    if (suppliersData.data && suppliersData.data.metaobjects) {
      suppliers = suppliersData.data.metaobjects.edges.map((e) => e.node);
    }
  } catch (error) {
    console.error("Error fetching suppliers:", error);
  }

  // Only fetch first page of products for quick initial stats
  let variants = [];
  let hasMoreProducts = false;
  try {
    const productsQuery = `
      query GetProducts {
        products(first: 50) {
          pageInfo {
            hasNextPage
          }
          edges {
            node {
              id
              title
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

    const response = await admin.graphql(productsQuery);
    const data = await response.json();

    if (data.data && data.data.products) {
      hasMoreProducts = data.data.products.pageInfo.hasNextPage;
      data.data.products.edges.forEach((productEdge) => {
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
    }
  } catch (error) {
    console.error("Error fetching products:", error);
  }

  return { variants, suppliers, hasMoreProducts, isPartialData: hasMoreProducts };
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "loadAllProducts") {
    // Fetch ALL products with pagination
    let allVariants = [];
    let hasNextPage = true;
    let cursor = null;
    let pageCount = 0;
    const maxPages = 50;

    while (hasNextPage && pageCount < maxPages) {
      try {
        const productsQuery = `
          query GetProducts($cursor: String) {
            products(first: 250, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                  title
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
          variables: { cursor },
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

// Helper function to get metafield value
function getMetafieldValue(metafields, namespace, key) {
  const metafield = metafields.find(
    (m) => m.namespace === namespace && m.key === key
  );
  return metafield ? metafield.value : null;
}

export default function SupplierDashboard() {
  const loaderData = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [sortColumn, setSortColumn] = useState("totalVariants");
  const [sortDirection, setSortDirection] = useState("descending");

  // Use fetcher data if available (full data), otherwise use loader data (partial)
  const variants = fetcher.data?.variants || loaderData.variants;
  const suppliers = loaderData.suppliers;
  const isPartialData = fetcher.data?.isComplete ? false : loaderData.isPartialData;
  const isLoading = fetcher.state === "submitting" || fetcher.state === "loading";

  const loadAllData = useCallback(() => {
    fetcher.submit({ intent: "loadAllProducts" }, { method: "post" });
  }, [fetcher]);

  // Calculate supplier statistics
  const supplierStatsRaw = useMemo(() => {
    const stats = {};

    // Initialize stats for all suppliers
    suppliers.forEach((supplier) => {
      const supplierId = supplier.fields.find((f) => f.key === "supplier_id")?.value;
      const supplierName = supplier.fields.find((f) => f.key === "supplier_name")?.value || "Unnamed";

      if (supplierId) {
        stats[supplierId] = {
          id: supplierId,
          name: supplierName,
          totalVariants: 0,
          primaryVariants: 0,
          totalValue: 0,
          atRiskVariants: 0,
          criticalVariants: 0,
          outOfStockVariants: 0,
          needsReorder: 0,
        };
      }
    });

    // Process variants
    variants.forEach((variant) => {
      const supplierData = getMetafieldValue(
        variant.metafields,
        "inventory",
        "supplier_data"
      );

      if (!supplierData) return;

      try {
        const parsed = JSON.parse(supplierData);
        const suppliersList = Array.isArray(parsed) ? parsed : [parsed];

        suppliersList.forEach((supplierInfo) => {
          const supplierId = supplierInfo.supplier_id;
          if (!stats[supplierId]) return;

          // Increment total variants
          stats[supplierId].totalVariants++;

          // Check if primary
          if (supplierInfo.is_primary) {
            stats[supplierId].primaryVariants++;
          }

          // Calculate risk and value
          const dailyDemand = parseFloat(supplierInfo.daily_demand) || 0;
          const threshold = parseInt(supplierInfo.threshold) || 0;
          const leadTime = parseInt(supplierInfo.lead_time) || 0;
          const lastOrderCpu = parseFloat(supplierInfo.last_order_cpu) || 0;
          const onHand = variant.inventoryQuantity;

          // Calculate days until stockout
          const daysUntilStockout =
            dailyDemand > 0 ? Math.floor((onHand - threshold) / dailyDemand) : 999;

          // Calculate reorder point
          const reorderPoint = threshold + dailyDemand * leadTime;

          // Update risk counters
          if (daysUntilStockout < 0) {
            stats[supplierId].outOfStockVariants++;
            stats[supplierId].atRiskVariants++;
          } else if (daysUntilStockout <= 7) {
            stats[supplierId].criticalVariants++;
            stats[supplierId].atRiskVariants++;
          } else if (daysUntilStockout <= 30) {
            stats[supplierId].atRiskVariants++;
          }

          // Check if needs reorder
          if (onHand <= reorderPoint) {
            stats[supplierId].needsReorder++;
          }

          // Calculate total inventory value for this supplier
          stats[supplierId].totalValue += onHand * lastOrderCpu;
        });
      } catch (e) {
        // Invalid JSON
      }
    });

    // Convert to array
    return Object.values(stats);
  }, [variants, suppliers]);

  // Apply sorting
  const supplierStats = useMemo(() => {
    const sorted = [...supplierStatsRaw];
    sorted.sort((a, b) => {
      let aVal, bVal;

      switch (sortColumn) {
        case "name":
          aVal = a.name || "";
          bVal = b.name || "";
          return sortDirection === "ascending"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        case "totalVariants":
          aVal = a.totalVariants;
          bVal = b.totalVariants;
          break;
        case "primaryVariants":
          aVal = a.primaryVariants;
          bVal = b.primaryVariants;
          break;
        case "outOfStock":
          aVal = a.outOfStockVariants;
          bVal = b.outOfStockVariants;
          break;
        case "critical":
          aVal = a.criticalVariants;
          bVal = b.criticalVariants;
          break;
        case "atRisk":
          aVal = a.atRiskVariants;
          bVal = b.atRiskVariants;
          break;
        case "needsReorder":
          aVal = a.needsReorder;
          bVal = b.needsReorder;
          break;
        case "totalValue":
          aVal = a.totalValue;
          bVal = b.totalValue;
          break;
        default:
          return 0;
      }

      return sortDirection === "ascending" ? aVal - bVal : bVal - aVal;
    });

    return sorted;
  }, [supplierStatsRaw, sortColumn, sortDirection]);

  const totalStats = useMemo(() => {
    return supplierStatsRaw.reduce(
      (acc, supplier) => ({
        totalVariants: acc.totalVariants + supplier.totalVariants,
        atRiskVariants: acc.atRiskVariants + supplier.atRiskVariants,
        totalValue: acc.totalValue + supplier.totalValue,
        needsReorder: acc.needsReorder + supplier.needsReorder,
      }),
      { totalVariants: 0, atRiskVariants: 0, totalValue: 0, needsReorder: 0 }
    );
  }, [supplierStatsRaw]);

  return (
    <>
      <TitleBar title="RMP Inventory Planner">
        <button variant="primary" onClick={() => navigate("/app/purchase-orders")}>
          Purchase Orders
        </button>
      </TitleBar>
      <Page fullWidth>
        <BlockStack gap="400">
          <AppNavigation />

          {isPartialData && !isLoading && (
            <Banner
              title="Showing partial data"
              tone="warning"
              action={{ content: "Load All Products", onAction: loadAllData }}
            >
              <p>Statistics are based on the first 50 products. Click "Load All Products" to see complete statistics for all products.</p>
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

          <InlineStack gap="400" wrap>
            <Card background="bg-surface-secondary">
              <BlockStack gap="100" inlineAlign="center">
                <Text variant="bodyMd" tone="subdued">
                  Total Suppliers
                </Text>
                <Text variant="heading2xl" as="h3">
                  {supplierStats.length}
                </Text>
              </BlockStack>
            </Card>
            <Card background="bg-surface-secondary">
              <BlockStack gap="100" inlineAlign="center">
                <Text variant="bodyMd" tone="subdued">
                  Total Products{isPartialData ? "*" : ""}
                </Text>
                <Text variant="heading2xl" as="h3">
                  {totalStats.totalVariants}
                </Text>
              </BlockStack>
            </Card>
            <Card background="bg-surface-secondary">
              <BlockStack gap="100" inlineAlign="center">
                <Text variant="bodyMd" tone="subdued">
                  At Risk Products{isPartialData ? "*" : ""}
                </Text>
                <Text variant="heading2xl" as="h3">
                  {totalStats.atRiskVariants}
                </Text>
              </BlockStack>
            </Card>
            <Card background="bg-surface-secondary">
              <BlockStack gap="100" inlineAlign="center">
                <Text variant="bodyMd" tone="subdued">
                  Needs Reorder{isPartialData ? "*" : ""}
                </Text>
                <Text variant="heading2xl" as="h3">
                  {totalStats.needsReorder}
                </Text>
              </BlockStack>
            </Card>
            <Card background="bg-surface-secondary">
              <BlockStack gap="100" inlineAlign="center">
                <Text variant="bodyMd" tone="subdued">
                  Total Inventory Value{isPartialData ? "*" : ""}
                </Text>
                <Text variant="heading2xl" as="h3">
                  ${totalStats.totalValue.toFixed(2)}
                </Text>
              </BlockStack>
            </Card>
          </InlineStack>

          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "supplier", plural: "suppliers" }}
              itemCount={supplierStats.length}
              headings={[
                { title: "Supplier Name" },
                { title: "Total Products" },
                { title: "Primary Products" },
                { title: "Out of Stock" },
                { title: "Critical" },
                { title: "At Risk" },
                { title: "Needs Reorder" },
                { title: "Inventory Value" },
              ]}
              selectable={false}
              sortable={[true, true, true, true, true, true, true, true]}
              sortDirection={sortDirection}
              sortColumnIndex={
                sortColumn === "name" ? 0 :
                sortColumn === "totalVariants" ? 1 :
                sortColumn === "primaryVariants" ? 2 :
                sortColumn === "outOfStock" ? 3 :
                sortColumn === "critical" ? 4 :
                sortColumn === "atRisk" ? 5 :
                sortColumn === "needsReorder" ? 6 :
                sortColumn === "totalValue" ? 7 : undefined
              }
              onSort={(index) => {
                const columns = ["name", "totalVariants", "primaryVariants", "outOfStock", "critical", "atRisk", "needsReorder", "totalValue"];
                const newColumn = columns[index];
                if (newColumn === sortColumn) {
                  setSortDirection(sortDirection === "ascending" ? "descending" : "ascending");
                } else {
                  setSortColumn(newColumn);
                  setSortDirection("descending");
                }
              }}
            >
              {supplierStats.map((supplier, index) => (
                <IndexTable.Row id={supplier.id} key={supplier.id} position={index}>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      {supplier.name}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{supplier.totalVariants}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="bodyMd" as="span">
                        {supplier.primaryVariants}
                      </Text>
                      {supplier.primaryVariants > 0 && (
                        <Badge tone="success" size="small">
                          Primary
                        </Badge>
                      )}
                    </InlineStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {supplier.outOfStockVariants > 0 ? (
                      <Badge tone="critical">{supplier.outOfStockVariants}</Badge>
                    ) : (
                      <Text variant="bodyMd" tone="subdued">
                        -
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {supplier.criticalVariants > 0 ? (
                      <Badge tone="warning">{supplier.criticalVariants}</Badge>
                    ) : (
                      <Text variant="bodyMd" tone="subdued">
                        -
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {supplier.atRiskVariants > 0 ? (
                      <Badge tone="attention">{supplier.atRiskVariants}</Badge>
                    ) : (
                      <Text variant="bodyMd" tone="subdued">
                        -
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {supplier.needsReorder > 0 ? (
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        {supplier.needsReorder}
                      </Text>
                    ) : (
                      <Text variant="bodyMd" tone="subdued">
                        -
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" as="span">
                      ${supplier.totalValue.toFixed(2)}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </BlockStack>
      </Page>
    </>
  );
}
