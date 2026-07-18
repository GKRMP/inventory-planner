import { useMemo } from "react";
import { Page, Card, IndexTable, Badge, BlockStack, Select, Text, EmptyState } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { listPurchaseOrders } from "../services/purchase-orders.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "all";
  const purchaseOrders = await listPurchaseOrders(session.shop, { status });
  return { purchaseOrders, status };
}

function money(n) {
  return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_TONE = {
  DRAFT: "info",
  SENT: "attention",
  PARTIAL: "warning",
  RECEIVED: "success",
  CANCELLED: undefined,
};

const STATUS_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Draft", value: "DRAFT" },
  { label: "Sent", value: "SENT" },
  { label: "Partial", value: "PARTIAL" },
  { label: "Received", value: "RECEIVED" },
  { label: "Cancelled", value: "CANCELLED" },
];

export default function PurchaseOrdersPage() {
  const { purchaseOrders, status } = useLoaderData();
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const rows = useMemo(() => purchaseOrders, [purchaseOrders]);

  return (
    <>
      <TitleBar title="RM Parts Inventory Management Program" />
      <Page title="Purchase Orders" fullWidth>
        <BlockStack gap="400">
          <Card>
            <div style={{ maxWidth: 240 }}>
              <Select
                label="Status"
                labelHidden
                options={STATUS_OPTIONS}
                value={status}
                onChange={(value) => setSearchParams(value === "all" ? {} : { status: value })}
              />
            </div>
          </Card>

          <Card padding="0">
            {rows.length === 0 ? (
              <EmptyState
                heading="No purchase orders yet"
                image=""
              >
                <p>Build a draft from the dashboard part detail or reorder list, then save it here.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "purchase order", plural: "purchase orders" }}
                itemCount={rows.length}
                headings={[
                  { title: "PO #" },
                  { title: "Supplier" },
                  { title: "Status" },
                  { title: "Items" },
                  { title: "Qty" },
                  { title: "Est. Cost" },
                  { title: "Created" },
                ]}
                selectable={false}
                onRowClick={(id) => navigate(`/app/purchase-orders/${id}`)}
              >
                {rows.map((po, index) => (
                  <IndexTable.Row id={po.id} key={po.id} position={index}>
                    <IndexTable.Cell>
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        #{po.number}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{po.supplierName}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={STATUS_TONE[po.status]}>{po.status}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{po.itemCount}</IndexTable.Cell>
                    <IndexTable.Cell>{po.totalQty}</IndexTable.Cell>
                    <IndexTable.Cell>{money(po.totalCost)}</IndexTable.Cell>
                    <IndexTable.Cell>{new Date(po.createdAt).toLocaleDateString()}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </BlockStack>
      </Page>
    </>
  );
}
