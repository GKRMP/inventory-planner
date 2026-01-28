import { useState, useMemo } from "react";
import { useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Card,
  IndexTable,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Select,
  Badge,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

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
}

// Helper function to get metafield value
function getMetafieldValue(metafields, namespace, key) {
  const metafield = metafields.find(
    (m) => m.namespace === namespace && m.key === key
  );
  return metafield ? metafield.value : null;
}

export default function PurchaseOrdersPage() {
  const { variants, suppliers } = useLoaderData();
  const navigate = useNavigate();

  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Get supplier options
  const supplierOptions = [
    { label: "All Suppliers", value: "" },
    ...suppliers.map((s) => ({
      label: s.fields.find((f) => f.key === "supplier_name")?.value || "Unnamed",
      value: s.fields.find((f) => f.key === "supplier_id")?.value || "",
    })),
  ];

  // Calculate recommended order quantities
  const purchaseOrderItems = useMemo(() => {
    const items = [];

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
          const dailyDemand = parseFloat(supplierInfo.daily_demand) || 0;
          const threshold = parseInt(supplierInfo.threshold) || 0;
          const leadTime = parseInt(supplierInfo.lead_time) || 0;
          const onHand = variant.inventoryQuantity;
          const lastOrderCpu = parseFloat(supplierInfo.last_order_cpu) || 0;

          // Calculate days until stockout
          const daysUntilStockout =
            dailyDemand > 0 ? Math.floor((onHand - threshold) / dailyDemand) : 999;

          // Calculate reorder point: threshold + (daily demand * lead time)
          const reorderPoint = threshold + dailyDemand * leadTime;

          // Calculate recommended order quantity: (daily demand * lead time * 2) - current inventory
          // This ensures we have enough for lead time plus buffer
          const recommendedQty = Math.max(
            0,
            Math.ceil(dailyDemand * leadTime * 2 + threshold - onHand)
          );

          // Only include items that need ordering (below reorder point or critical)
          if (onHand <= reorderPoint || daysUntilStockout <= 30) {
            const supplier = suppliers.find((s) =>
              s.fields.some(
                (f) => f.key === "supplier_id" && f.value === supplierInfo.supplier_id
              )
            );

            const supplierName =
              supplier?.fields.find((f) => f.key === "supplier_name")?.value || "Unknown";

            items.push({
              variantId: variant.id,
              sku: variant.sku,
              productTitle: variant.productTitle,
              variantTitle: variant.variantTitle,
              supplierId: supplierInfo.supplier_id,
              supplierName,
              onHand,
              threshold,
              dailyDemand,
              leadTime,
              daysUntilStockout,
              reorderPoint,
              recommendedQty,
              lastOrderCpu,
              estimatedCost: recommendedQty * lastOrderCpu,
              isPrimary: supplierInfo.is_primary || false,
            });
          }
        });
      } catch (e) {
        // Invalid JSON
      }
    });

    // Sort by urgency (days until stockout)
    return items.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
  }, [variants, suppliers]);

  // Filter by supplier and search
  const filteredItems = useMemo(() => {
    let items = purchaseOrderItems;

    if (selectedSupplier) {
      items = items.filter((item) => item.supplierId === selectedSupplier);
    }

    if (searchQuery) {
      items = items.filter(
        (item) =>
          item.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.productTitle?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return items;
  }, [purchaseOrderItems, selectedSupplier, searchQuery]);

  // Calculate totals for selected supplier
  const totals = useMemo(() => {
    return {
      totalItems: filteredItems.length,
      totalQty: filteredItems.reduce((sum, item) => sum + item.recommendedQty, 0),
      totalCost: filteredItems.reduce((sum, item) => sum + item.estimatedCost, 0),
    };
  }, [filteredItems]);

  const getRiskBadge = (days) => {
    if (days < 0) return <Badge tone="critical">Out of Stock</Badge>;
    if (days <= 7) return <Badge tone="critical">Critical</Badge>;
    if (days <= 14) return <Badge tone="warning">Warning</Badge>;
    if (days <= 30) return <Badge tone="info">Attention</Badge>;
    return <Badge tone="success">Low Risk</Badge>;
  };

  const generatePO = () => {
    if (filteredItems.length === 0) {
      alert("No items to include in purchase order");
      return;
    }

    const supplierName = selectedSupplier
      ? supplierOptions.find((s) => s.value === selectedSupplier)?.label || "All Suppliers"
      : "All Suppliers";

    // Generate PO content
    let poContent = `PURCHASE ORDER\n`;
    poContent += `Generated: ${new Date().toLocaleDateString()}\n`;
    poContent += `Supplier: ${supplierName}\n`;
    poContent += `\n`;
    poContent += `Items to Order (${filteredItems.length}):\n`;
    poContent += `${"=".repeat(100)}\n`;
    poContent += `SKU`.padEnd(20) +
                 `Product`.padEnd(35) +
                 `On Hand`.padEnd(12) +
                 `Order Qty`.padEnd(12) +
                 `Unit Cost`.padEnd(12) +
                 `Total\n`;
    poContent += `${"-".repeat(100)}\n`;

    filteredItems.forEach((item) => {
      poContent += `${(item.sku || "N/A").padEnd(20)}${item.productTitle.substring(0, 33).padEnd(35)}${String(item.onHand).padEnd(12)}${String(item.recommendedQty).padEnd(12)}$${item.lastOrderCpu.toFixed(2).padEnd(11)}$${item.estimatedCost.toFixed(2)}\n`;
    });

    poContent += `${"-".repeat(100)}\n`;
    poContent += `Total Items: ${totals.totalItems}\n`;
    poContent += `Total Quantity: ${totals.totalQty}\n`;
    poContent += `Estimated Total Cost: $${totals.totalCost.toFixed(2)}\n`;

    // Download as text file
    const blob = new Blob([poContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PO_${supplierName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <TitleBar title="RMP Inventory Planner" />
      <Page
        title="Purchase Orders"
        fullWidth
        primaryAction={{
          content: "Generate PO",
          onAction: generatePO,
          disabled: filteredItems.length === 0,
        }}
      >
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="400" align="start" wrap={false}>
                <div style={{ flex: 1 }}>
                  <Select
                    label="Filter by Supplier"
                    options={supplierOptions}
                    value={selectedSupplier}
                    onChange={setSelectedSupplier}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Search by SKU or Product"
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search..."
                    clearButton
                    onClearButtonClick={() => setSearchQuery("")}
                  />
                </div>
              </InlineStack>

              <InlineStack gap="400">
                <Card background="bg-surface-secondary">
                  <BlockStack gap="100">
                    <Text variant="bodyMd" tone="subdued">
                      Items
                    </Text>
                    <Text variant="heading2xl" as="h3">
                      {totals.totalItems}
                    </Text>
                  </BlockStack>
                </Card>
                <Card background="bg-surface-secondary">
                  <BlockStack gap="100">
                    <Text variant="bodyMd" tone="subdued">
                      Total Quantity
                    </Text>
                    <Text variant="heading2xl" as="h3">
                      {totals.totalQty}
                    </Text>
                  </BlockStack>
                </Card>
                <Card background="bg-surface-secondary">
                  <BlockStack gap="100">
                    <Text variant="bodyMd" tone="subdued">
                      Estimated Cost
                    </Text>
                    <Text variant="heading2xl" as="h3">
                      ${totals.totalCost.toFixed(2)}
                    </Text>
                  </BlockStack>
                </Card>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "item", plural: "items" }}
              itemCount={filteredItems.length}
              headings={[
                { title: "SKU" },
                { title: "Product" },
                { title: "Supplier" },
                { title: "On Hand" },
                { title: "Reorder Point" },
                { title: "Recommended Qty" },
                { title: "Unit Cost" },
                { title: "Total Cost" },
                { title: "Status" },
              ]}
              selectable={false}
            >
              {filteredItems.map((item, index) => (
                <IndexTable.Row id={item.variantId} key={item.variantId + item.supplierId} position={index}>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      {item.sku || "N/A"}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text variant="bodyMd">{item.productTitle}</Text>
                      <Text variant="bodySm" tone="subdued">
                        {item.variantTitle}
                      </Text>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {item.supplierName}
                    {item.isPrimary && (
                      <Badge tone="success" size="small">
                        Primary
                      </Badge>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{item.onHand}</IndexTable.Cell>
                  <IndexTable.Cell>{item.reorderPoint}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      {item.recommendedQty}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>${item.lastOrderCpu.toFixed(2)}</IndexTable.Cell>
                  <IndexTable.Cell>${item.estimatedCost.toFixed(2)}</IndexTable.Cell>
                  <IndexTable.Cell>{getRiskBadge(item.daysUntilStockout)}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </BlockStack>
      </Page>
    </>
  );
}
