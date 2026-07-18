import { useState } from "react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { getPurchaseOrder, updateStatus, receiveLine } from "../services/purchase-orders.server";

export async function loader({ request, params }) {
  const { session } = await authenticate.admin(request);
  const po = await getPurchaseOrder(session.shop, params.id);
  if (!po) throw new Response("Purchase order not found", { status: 404 });
  return { po };
}

export async function action({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();

  if (body.intent === "send") {
    return Response.json(await updateStatus(session.shop, params.id, "SENT"));
  }
  if (body.intent === "cancel") {
    return Response.json(await updateStatus(session.shop, params.id, "CANCELLED"));
  }
  if (body.intent === "receive") {
    return Response.json(await receiveLine(session.shop, { admin, lineItemId: body.lineItemId, qty: body.qty }));
  }
  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

function money(n) {
  return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_TONE = { DRAFT: "info", SENT: "attention", PARTIAL: "warning", RECEIVED: "success", CANCELLED: undefined };

export default function PurchaseOrderDetail() {
  const { po } = useLoaderData();
  const statusFetcher = useFetcher();
  const receiveFetcher = useFetcher();
  const [qtyByLine, setQtyByLine] = useState({});

  const submitStatus = (intent) => {
    statusFetcher.submit(JSON.stringify({ intent }), { method: "POST", encType: "application/json" });
  };

  const submitReceive = (lineItemId, remaining) => {
    const qty = Math.min(Math.max(1, parseInt(qtyByLine[lineItemId], 10) || remaining), remaining);
    receiveFetcher.submit(JSON.stringify({ intent: "receive", lineItemId, qty }), {
      method: "POST",
      encType: "application/json",
    });
  };

  const error = receiveFetcher.data?.error || statusFetcher.data?.error;

  return (
    <>
      <TitleBar title={`Purchase Order #${po.number}`} />
      <Page
        title={`Purchase order #${po.number}`}
        backAction={{ content: "Purchase Orders", url: "/app/purchase-orders" }}
        titleMetadata={<Badge tone={STATUS_TONE[po.status]}>{po.status}</Badge>}
        primaryAction={
          po.status === "DRAFT"
            ? { content: "Send", onAction: () => submitStatus("send"), loading: statusFetcher.state !== "idle" }
            : undefined
        }
        secondaryActions={
          po.status !== "CANCELLED" && po.status !== "RECEIVED"
            ? [{ content: "Cancel PO", destructive: true, onAction: () => submitStatus("cancel") }]
            : []
        }
      >
        <BlockStack gap="400">
          {error && <Banner tone="critical">{error}</Banner>}

          <Card>
            <InlineStack gap="800">
              <BlockStack gap="100">
                <Text tone="subdued" variant="bodySm">Supplier</Text>
                <Text fontWeight="semibold" as="span">{po.supplierName}</Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text tone="subdued" variant="bodySm">Items</Text>
                <Text as="span">{po.itemCount}</Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text tone="subdued" variant="bodySm">Total qty</Text>
                <Text as="span">{po.totalQty}</Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text tone="subdued" variant="bodySm">Est. cost</Text>
                <Text as="span">{money(po.totalCost)}</Text>
              </BlockStack>
              {po.sentAt && (
                <BlockStack gap="100">
                  <Text tone="subdued" variant="bodySm">Sent</Text>
                  <Text as="span">{new Date(po.sentAt).toLocaleDateString()}</Text>
                </BlockStack>
              )}
              {po.receivedAt && (
                <BlockStack gap="100">
                  <Text tone="subdued" variant="bodySm">Received</Text>
                  <Text as="span">{new Date(po.receivedAt).toLocaleDateString()}</Text>
                </BlockStack>
              )}
            </InlineStack>
          </Card>

          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "line item", plural: "line items" }}
              itemCount={po.lineItems.length}
              headings={[
                { title: "SKU" },
                { title: "Product" },
                { title: "MPN" },
                { title: "Ordered" },
                { title: "Received" },
                { title: "Unit Cost" },
                { title: "" },
              ]}
              selectable={false}
            >
              {po.lineItems.map((line, index) => {
                const remaining = line.qtyOrdered - line.qtyReceived;
                const fullyReceived = remaining <= 0;
                const canReceive = po.status === "SENT" || po.status === "PARTIAL";
                return (
                  <IndexTable.Row id={line.id} key={line.id} position={index}>
                    <IndexTable.Cell>
                      <Text fontWeight="semibold" as="span">{line.sku || "N/A"}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Text as="span">{line.productTitle || "Unknown"}</Text>
                        <Text tone="subdued" variant="bodySm">{line.variantTitle}</Text>
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{line.mpn || "–"}</IndexTable.Cell>
                    <IndexTable.Cell>{line.qtyOrdered}</IndexTable.Cell>
                    <IndexTable.Cell>
                      {fullyReceived ? (
                        <Badge tone="success">{line.qtyReceived}</Badge>
                      ) : (
                        line.qtyReceived
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>{money(line.unitCost)}</IndexTable.Cell>
                    <IndexTable.Cell>
                      {canReceive && !fullyReceived ? (
                        <InlineStack gap="200" blockAlign="center">
                          <div style={{ width: 80 }}>
                            <TextField
                              label="Qty"
                              labelHidden
                              type="number"
                              min={1}
                              max={remaining}
                              value={String(qtyByLine[line.id] ?? remaining)}
                              onChange={(value) => setQtyByLine((prev) => ({ ...prev, [line.id]: value }))}
                              autoComplete="off"
                            />
                          </div>
                          <Button
                            onClick={() => submitReceive(line.id, remaining)}
                            loading={receiveFetcher.state !== "idle"}
                          >
                            Receive
                          </Button>
                        </InlineStack>
                      ) : null}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>
          </Card>
        </BlockStack>
      </Page>
    </>
  );
}
