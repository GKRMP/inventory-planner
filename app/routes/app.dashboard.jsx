import { useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  ChoiceList,
  Button,
  Collapsible,
  Icon,
} from "@shopify/polaris";
import { FilterIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useMemo, useState, useCallback } from "react";
import { ResponsiveBar } from "@nivo/bar";
import AppNavigation from "../components/AppNavigation";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    // Get URL params for filters
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status") || "ACTIVE";
    const channelsParam = url.searchParams.get("channels") || "online,pos";
    const selectedChannels = channelsParam.split(",").filter(Boolean);

    // Fetch available publications (channels)
    const publicationsQuery = `
      {
        publications(first: 20) {
          nodes {
            id
            catalog {
              id
              title
            }
          }
        }
      }
    `;

    const publicationsResponse = await admin.graphql(publicationsQuery);
    const publicationsData = await publicationsResponse.json();

    const publications = publicationsData.data?.publications?.nodes || [];

    // Map common channel names to their publication IDs
    const channelMap = {};
    publications.forEach((pub) => {
      const title = pub.catalog?.title?.toLowerCase() || "";
      if (title.includes("online store")) {
        channelMap.online = pub.id;
      } else if (title.includes("point of sale") || title.includes("pos")) {
        channelMap.pos = pub.id;
      } else if (title.includes("shop")) {
        channelMap.shop = pub.id;
      }
    });

    // Fetch products with status filter
    const queryFilter = statusFilter ? `status:${statusFilter}` : "";

    // Fetch first page of products (for quick load)
    const productsQuery = `
      query GetProducts($query: String) {
        products(first: 100, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              status
              resourcePublications(first: 10) {
                nodes {
                  isPublished
                  publication {
                    id
                    catalog {
                      title
                    }
                  }
                }
              }
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
      admin.graphql(productsQuery, { variables: { query: queryFilter } }),
      admin.graphql(suppliersQuery),
    ]);

    const productsData = await productsResponse.json();
    const suppliersData = await suppliersResponse.json();

    if (!productsData.data || !suppliersData.data) {
      console.error("API Response error:", { productsData, suppliersData });
      return {
        variants: [],
        suppliers: [],
        publications,
        channelMap,
        currentStatus: statusFilter,
        currentChannels: selectedChannels,
        hasMoreProducts: false,
      };
    }

    // Transform data, filtering by selected channels
    const variants = [];
    productsData.data.products.edges.forEach((productEdge) => {
      const product = productEdge.node;

      // Check if product is published to any of the selected channels
      const publishedChannels = product.resourcePublications?.nodes || [];
      const isPublishedToSelectedChannel = publishedChannels.some((rp) => {
        if (!rp.isPublished) return false;
        const pubTitle = rp.publication?.catalog?.title?.toLowerCase() || "";

        return selectedChannels.some((ch) => {
          if (ch === "online" && pubTitle.includes("online store")) return true;
          if (ch === "pos" && (pubTitle.includes("point of sale") || pubTitle.includes("pos"))) return true;
          if (ch === "shop" && pubTitle.includes("shop") && !pubTitle.includes("online")) return true;
          return false;
        });
      });

      // If no channels selected, show all; otherwise filter
      if (selectedChannels.length === 0 || isPublishedToSelectedChannel) {
        product.variants.edges.forEach((variantEdge) => {
          const variant = variantEdge.node;
          variants.push({
            id: variant.id,
            sku: variant.sku,
            variantTitle: variant.title,
            productTitle: product.title,
            productStatus: product.status,
            inventoryQuantity: variant.inventoryQuantity || 0,
            metafields: variant.metafields.edges.map((m) => m.node),
          });
        });
      }
    });

    const suppliers = suppliersData.data.metaobjects.edges.map((e) => e.node);
    const hasMoreProducts = productsData.data.products.pageInfo?.hasNextPage || false;

    return {
      variants,
      suppliers,
      publications,
      channelMap,
      currentStatus: statusFilter,
      currentChannels: selectedChannels,
      hasMoreProducts,
    };
  } catch (error) {
    console.error("Dashboard loader error:", error);
    return {
      variants: [],
      suppliers: [],
      publications: [],
      channelMap: {},
      currentStatus: "ACTIVE",
      currentChannels: ["online", "pos"],
      hasMoreProducts: false,
    };
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
        const primarySupplier = parsed.find((s) => s.is_primary) || parsed[0];
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
  const daysUntilStockout =
    dailyDemand > 0 ? Math.floor((onHand - threshold) / dailyDemand) : 999;

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
  const {
    variants,
    suppliers,
    currentStatus,
    currentChannels,
    hasMoreProducts,
  } = useLoaderData();
  const navigate = useNavigate();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState([currentStatus]);
  const [channelFilter, setChannelFilter] = useState(currentChannels);

  const handleStatusChange = useCallback((value) => {
    setStatusFilter(value);
  }, []);

  const handleChannelChange = useCallback((value) => {
    setChannelFilter(value);
  }, []);

  const applyFilters = useCallback(() => {
    const status = statusFilter.length > 0 ? statusFilter[0] : "ACTIVE";
    const channels = channelFilter.join(",");
    navigate(`/app/dashboard?status=${status}&channels=${channels}`);
  }, [statusFilter, channelFilter, navigate]);

  const resetFilters = useCallback(() => {
    setStatusFilter(["ACTIVE"]);
    setChannelFilter(["online", "pos"]);
    navigate("/app/dashboard?status=ACTIVE&channels=online,pos");
  }, [navigate]);

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
      percentage:
        totalVariants > 0 ? ((count / totalVariants) * 100).toFixed(1) : 0,
    }));
  }, [riskStats, totalVariants]);

  return (
    <>
      <TitleBar title="RMP Inventory Planner" />
      <Page fullWidth>
        <BlockStack gap="400">
          <AppNavigation />

          {/* Filters Section */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Button
                  onClick={() => setFiltersOpen(!filtersOpen)}
                  icon={<Icon source={FilterIcon} />}
                  disclosure={filtersOpen ? "up" : "down"}
                >
                  Filters
                </Button>
                {(statusFilter[0] !== "ACTIVE" ||
                  channelFilter.join(",") !== "online,pos") && (
                  <Button variant="plain" onClick={resetFilters}>
                    Reset to defaults
                  </Button>
                )}
              </InlineStack>

              <Collapsible open={filtersOpen} id="filters-collapsible">
                <BlockStack gap="400">
                  <InlineStack gap="800" wrap>
                    <div style={{ minWidth: "200px" }}>
                      <ChoiceList
                        title="Product Status"
                        choices={[
                          { label: "Active", value: "ACTIVE" },
                          { label: "Draft", value: "DRAFT" },
                          { label: "Archived", value: "ARCHIVED" },
                        ]}
                        selected={statusFilter}
                        onChange={handleStatusChange}
                      />
                    </div>
                    <div style={{ minWidth: "200px" }}>
                      <ChoiceList
                        title="Sales Channels"
                        choices={[
                          { label: "Online Store", value: "online" },
                          { label: "Point of Sale", value: "pos" },
                          { label: "Shop App", value: "shop" },
                        ]}
                        selected={channelFilter}
                        onChange={handleChannelChange}
                        allowMultiple
                      />
                    </div>
                  </InlineStack>
                  <InlineStack gap="200">
                    <Button variant="primary" onClick={applyFilters}>
                      Apply Filters
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>

          <Card>
            <div style={{ padding: "16px" }}>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    Inventory Risk Overview
                  </Text>
                  <BlockStack gap="100" inlineAlign="end">
                    <Text variant="bodyMd" as="p" tone="subdued">
                      {totalVariants} products
                      {hasMoreProducts ? " (partial view)" : ""}
                    </Text>
                    <Text variant="bodySm" as="p" tone="subdued">
                      Status: {statusFilter[0]} | Channels:{" "}
                      {channelFilter.join(", ") || "All"}
                    </Text>
                  </BlockStack>
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
