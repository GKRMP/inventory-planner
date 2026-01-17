import {
  IndexTable,
  useIndexResourceState,
  Button,
  InlineStack,
} from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

import DeleteModal from "./DeleteModal";
import { useDeleteResource } from "../hooks/useDeleteResource";

export default function SupplierPartTable({ rows, onDeleted }) {
  const navigate = useNavigate();

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(rows);

  const [deleteId, setDeleteId] = useState(null);
  const { deleteResource, deleting } = useDeleteResource();

  async function confirmDelete() {
    const result = await deleteResource(`/api/supplier-parts/${deleteId}`);

    if (result.success) {
      onDeleted();
      setDeleteId(null);
    }
  }

  const rowMarkup = rows.map((row, index) => {
    const {
      id,
      sku,
      supplier,
      lead_time_days,
      threshold,
      last_order_date,
      last_order_cpu,
      last_order_quantity,
    } = row;

    return (
      <IndexTable.Row
        id={id}
        key={id}
        selected={selectedResources.includes(id)}
        position={index}
      >
        <IndexTable.Cell>{sku}</IndexTable.Cell>
        <IndexTable.Cell>{supplier}</IndexTable.Cell>
        <IndexTable.Cell>{lead_time_days}</IndexTable.Cell>
        <IndexTable.Cell>{threshold}</IndexTable.Cell>
        <IndexTable.Cell>{last_order_date}</IndexTable.Cell>
        <IndexTable.Cell>{last_order_cpu}</IndexTable.Cell>
        <IndexTable.Cell>{last_order_quantity}</IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200">
            <Button onClick={() => navigate(`/supplier-parts/${id}`)}>
              Edit
            </Button>
            <Button tone="critical" onClick={() => setDeleteId(id)}>
              Delete
            </Button>
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <>
      <IndexTable
        resourceName={{
          singular: "supplier-part link",
          plural: "supplier-part links",
        }}
        itemCount={rows.length}
        selectedItemsCount={
          allResourcesSelected ? "All" : selectedResources.length
        }
        onSelectionChange={handleSelectionChange}
        headings={[
          { title: "SKU" },
          { title: "Supplier" },
          { title: "Lead Time" },
          { title: "Threshold" },
          { title: "Last Order Date" },
          { title: "Last Order CPU" },
          { title: "Last Order Qty" },
          { title: "Actions" },
        ]}
      >
        {rowMarkup}
      </IndexTable>

      <DeleteModal
        open={!!deleteId}
        title="Delete Supplier–Part Link"
        message="Are you sure you want to delete this supplier–part link?"
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        loading={deleting}
      />
    </>
  );
}