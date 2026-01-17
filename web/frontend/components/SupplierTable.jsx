import {
  IndexTable,
  useIndexResourceState,
  Button,
  Badge,
  InlineStack,
} from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

import DeleteModal from "./DeleteModal";
import { useDeleteResource } from "../hooks/useDeleteResource";

export default function SupplierTable({ rows, onDeleted }) {
  const navigate = useNavigate();

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(rows);

  const [deleteId, setDeleteId] = useState(null);
  const { deleteResource, deleting, error } = useDeleteResource();

  async function confirmDelete() {
    const result = await deleteResource(`/api/suppliers/${deleteId}`);

    if (result.success) {
      onDeleted();
      setDeleteId(null);
    }
  }

  const rowMarkup = rows.map((row, index) => {
    const { id, supplier_name, supplier_id, contact_name_1, phone_1, email_1 } = row;

    return (
      <IndexTable.Row
        id={id}
        key={id}
        selected={selectedResources.includes(id)}
        position={index}
      >
        <IndexTable.Cell>{supplier_name}</IndexTable.Cell>
        <IndexTable.Cell>{supplier_id}</IndexTable.Cell>
        <IndexTable.Cell>{contact_name_1}</IndexTable.Cell>
        <IndexTable.Cell>{phone_1}</IndexTable.Cell>
        <IndexTable.Cell>{email_1}</IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200">
            <Button onClick={() => navigate(`/suppliers/${id}`)}>Edit</Button>
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
        resourceName={{ singular: "supplier", plural: "suppliers" }}
        itemCount={rows.length}
        selectedItemsCount={
          allResourcesSelected ? "All" : selectedResources.length
        }
        onSelectionChange={handleSelectionChange}
        headings={[
          { title: "Name" },
          { title: "Supplier ID" },
          { title: "Contact" },
          { title: "Phone" },
          { title: "Email" },
          { title: "Actions" },
        ]}
      >
        {rowMarkup}
      </IndexTable>

      <DeleteModal
        open={!!deleteId}
        title="Delete Supplier"
        message="Are you sure you want to delete this supplier? This cannot be undone."
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        loading={deleting}
      />
    </>
  );
}