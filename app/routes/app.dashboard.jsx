import { useLoaderData } from "react-router";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useMemo } from "react";
import { ResponsiveBar } from "@nivo/bar";
import AppNavigation from "../components/AppNavigation";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    // Fetch all products with variants and inventory
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
      admin.graphql(productsQuery),
      admin.graphql(suppliersQuery),
    ]);

    const productsData = await productsResponse.json();
    const suppliersData = await suppliersResponse.json();

    if (!productsData.data || !suppliersData.data) {
      console.error("API Response error:", { productsData, suppliersData });
      return { variants: [], suppliers: [] };
    }

    // Transform data for easier use
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
  } catch (error) {
    console.error("Dashboard loader error:", error);
    return { variants: [], suppliers: [] };
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

  if (supplierData) {
    try {
      const parsed = JSON.parse(supplierData);

      // Handle array format (multiple suppliers) - use primary supplier
      if (Array.isArray(parsed)) {
        const primarySupplier = parsed.find(s => s.is_primary) || parsed[0];
        if (primarySupplier) {
          dailyDemand = parseFloat(primarySupplier.daily_demand) || 0;
          threshold = parseInt(primarySupplier.threshold) || 0;
        }
      } else {
        // Handle old single supplier format
        dailyDemand = parseFloat(parsed.daily_demand) || 0;
        threshold = parseInt(parsed.threshold) || 0;
      }
    } catch (e) {
      // Invalid JSON
    }
  }

  const onHand = variant.inventoryQuantity;
  const daysUntilStockout = dailyDemand > 0 ? Math.floor((onHand - threshold) / dailyDemand) : 999;

  // Calculate risk level
  let riskLevel = "low";
  if (daysUntilStockout < 0) {
    riskLevel = "out_of_stock";
  } else if (daysUntilStockout <= 7) {
    riskLevel = "critical";
  } else if (daysUntilStockout <= 14) {
    riskLevel = "warning";
  } else if (daysUntilStockout <= 30) {
    riskLevel = "attention";
  }

  return { riskLevel };
}

export default function Dashboard() {
  const { variants, suppliers } = useLoaderData();

  // Calculate risk distribution
  const riskStats = useMemo(() => {
    const stats = {
      out_of_stock: 0,
      critical: 0,
      warning: 0,
      attention: 0,
      low: 0,
    };

    variants.forEach((variant) => {
      const metrics = calculateMetrics(variant, suppliers);
      stats[metrics.riskLevel]++;
    });

    return stats;
  }, [variants, suppliers]);

  const totalVariants = variants.length;

  const riskColors = {
    out_of_stock: "#D72C0D",
    critical: "#D72C0D",
    warning: "#FFC453",
    attention: "#0B7CFF",
    low: "#008060",
  };

  const riskLabels = {
    out_of_stock: "Out of Stock",
    critical: "Critical",
    warning: "Warning",
    attention: "Attention",
    low: "Low Risk",
  };

  // Transform data for Nivo bar chart
  const chartData = useMemo(() => {
    return Object.entries(riskStats).map(([risk, count]) => ({
      risk: riskLabels[risk],
      count,
      color: riskColors[risk],
      percentage: totalVariants > 0 ? ((count / totalVariants) * 100).toFixed(1) : 0,
    }));
  }, [riskStats, totalVariants]);

  return (
    <>
      <TitleBar title="RMP Inventory Planner" />
      <Page fullWidth>
        <BlockStack gap="400">
          <AppNavigation />
          <Card>
          <div style={{ padding: "16px" }}>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  Inventory Risk Overview
                </Text>
                <Text variant="bodyMd" as="p" tone="subdued">
                  {totalVariants} total products
                </Text>
              </InlineStack>

              <div style={{ height: "300px", width: "100%" }}>
                <ResponsiveBar
                  data={chartData}
                  keys={["count"]}
                  indexBy="risk"
                  layout="horizontal"
                  margin={{ top: 10, right: 80, bottom: 10, left: 100 }}
                  padding={0.3}
                  valueScale={{ type: "linear" }}
                  indexScale={{ type: "band", round: true }}
                  colors={({ data }) => data.color}
                  borderRadius={4}
                  axisTop={null}
                  axisRight={null}
                  axisBottom={null}
                  axisLeft={{
                    tickSize: 0,
                    tickPadding: 10,
                    tickRotation: 0,
                  }}
                  enableGridX={false}
                  enableGridY={false}
                  labelSkipWidth={12}
                  labelSkipHeight={12}
                  label={(d) => `${d.value} (${d.data.percentage}%)`}
                  labelTextColor="#ffffff"
                  animate={true}
                  motionConfig="gentle"
                  role="application"
                  ariaLabel="Inventory risk distribution"
                  barAriaLabel={(e) =>
                    `${e.indexValue}: ${e.value} items (${e.data.percentage}%)`
                  }
                />
              </div>

            </BlockStack>
          </div>
        </Card>
        </BlockStack>
      </Page>
    </>
  );
}
