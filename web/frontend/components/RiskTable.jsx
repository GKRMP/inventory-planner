import {
  IndexTable,
  useIndexResourceState,
  Badge,
  Text,
} from "@shopify/polaris";

export default function RiskTable({ rows }) {
  const resourceName = {
    singular: "SKU",
    plural: "SKUs",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(rows);

  const rowMarkup = rows.map((row, index) => {
    const {
      sku,
      product_title,
      on_hand,
      daily_demand,
      threshold,
      supplier_name,
      lead_time_days,
      days_until_stockout,
      reorder_date,
      out_of_stock_date,
      suggested_order_size,
      risk_color,
    } = row;

    const colorMap = {
      red: "critical",
      orange: "warning",
      yellow: "attention",
      green: "success",
    };

    return (
      <IndexTable.Row
        id={sku}
        key={sku}
        selected={selectedResources.includes(sku)}
        position={index}
      >
        <IndexTable.Cell>
          <Badge tone={colorMap[risk_color] || "base"}>{risk_color}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{sku}</IndexTable.Cell>
        <IndexTable.Cell>{product_title}</IndexTable.Cell>
        <IndexTable.Cell>{on_hand}</IndexTable.Cell>
        <IndexTable.Cell>{daily_demand}</IndexTable.Cell>
        <IndexTable.Cell>{threshold}</IndexTable.Cell>
        <IndexTable.Cell>{supplier_name}</IndexTable.Cell>
        <IndexTable.Cell>{lead_time_days}</IndexTable.Cell>
        <IndexTable.Cell>{days_until_stockout.toFixed(1)}</IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(reorder_date).toLocaleDateString()}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(out_of_stock_date).toLocaleDateString()}
        </IndexTable.Cell>
        <IndexTable.Cell>{suggested_order_size}</IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <IndexTable
      resourceName={resourceName}
      itemCount={rows.length}
      selectedItemsCount={
        allResourcesSelected ? "All" : selectedResources.length
      }
      onSelectionChange={handleSelectionChange}
      headings={[
        { title: "Risk" },
        { title: "SKU" },
        { title: "Product" },
        { title: "On Hand" },
        { title: "Demand" },
        { title: "Threshold" },
        { title: "Supplier" },
        { title: "Lead Time" },
        { title: "Days Until Stock-Out" },
        { title: "Reorder Date" },
        { title: "Stock-Out Date" },
        { title: "Suggested Order" },
      ]}
    >
      {rowMarkup}
    </IndexTable>
  );
}