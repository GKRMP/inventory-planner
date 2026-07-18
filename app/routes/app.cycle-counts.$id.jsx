import { useState } from "react";
import { Page, Card, BlockStack, InlineStack, Text, Badge, TextField, Button, Banner, Checkbox } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { getSession, recordCount, closeSession } from "../services/cycle-counts.server";

export async function loader({ request, params }) {
  const { session } = await authenticate.admin(request);
  const cycleSession = await getSession(session.shop, params.id);
  if (!cycleSession) throw new Response("Cycle count session not found", { status: 404 });
  return { cycleSession };
}

export async function action({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();

  if (body.intent === "count") {
    return Response.json(await recordCount(session.shop, body.itemId, { countedQty: body.countedQty, note: body.note }));
  }
  if (body.intent === "close") {
    return Response.json(
      await closeSession(session.shop, params.id, { admin, applyCorrections: !!body.applyCorrections })
    );
  }
  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

/* eslint-disable react/prop-types -- internal presentational helper, not a public component */
function ChecklistRow({ item, disabled }) {
  const fetcher = useFetcher();
  const [countedQty, setCountedQty] = useState(item.countedQty !== null ? String(item.countedQty) : "");
  const isCounted = item.countedQty !== null || fetcher.data?.ok;
  const discrepancy = item.countedQty !== null && item.countedQty !== item.expectedQty;

  const submitCount = () => {
    if (countedQty === "") return;
    fetcher.submit(JSON.stringify({ intent: "count", itemId: item.id, countedQty: parseInt(countedQty, 10) || 0 }), {
      method: "post",
      encType: "application/json",
    });
  };

  return (
    <div style={{ borderBottom: "1px solid #e8e6e0", padding: "12px 0" }}>
      <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text fontWeight="semibold" as="span">{item.sku || "N/A"}</Text>
          <Text tone="subdued" variant="bodySm" as="p">{item.productTitle}</Text>
          {item.binLocation && <Text tone="subdued" variant="bodySm" as="p">Bin {item.binLocation}</Text>}
        </div>
        <Text as="span" tone="subdued">Expected {item.expectedQty}</Text>
        <div style={{ width: 90 }}>
          <TextField
            label="Counted"
            labelHidden
            type="number"
            min={0}
            value={countedQty}
            onChange={setCountedQty}
            onBlur={submitCount}
            disabled={disabled}
            autoComplete="off"
          />
        </div>
        {isCounted && (discrepancy ? <Badge tone="warning">Mismatch</Badge> : <Badge tone="success">OK</Badge>)}
      </InlineStack>
    </div>
  );
}
/* eslint-enable react/prop-types */

export default function CycleCountDetail() {
  const { cycleSession } = useLoaderData();
  const closeFetcher = useFetcher();
  const [applyCorrections, setApplyCorrections] = useState(true);
  const busy = closeFetcher.state !== "idle";
  const isOpen = cycleSession.status === "OPEN" && !closeFetcher.data?.ok;

  const discrepancyCount = cycleSession.items.filter(
    (i) => i.countedQty !== null && i.countedQty !== i.expectedQty
  ).length;

  const handleClose = () => {
    closeFetcher.submit(JSON.stringify({ intent: "close", applyCorrections }), {
      method: "post",
      encType: "application/json",
    });
  };

  return (
    <>
      <TitleBar title={cycleSession.name} />
      <Page
        title={cycleSession.name}
        backAction={{ content: "Cycle Counts", url: "/app/cycle-counts" }}
        titleMetadata={<Badge tone={isOpen ? "info" : "success"}>{isOpen ? "OPEN" : "CLOSED"}</Badge>}
      >
        <BlockStack gap="400">
          {closeFetcher.data?.error && <Banner tone="critical">{closeFetcher.data.error}</Banner>}
          {closeFetcher.data?.ok && (
            <Banner tone="success" title="Session closed">
              {closeFetcher.data.corrections?.filter((c) => c.ok).length > 0 && (
                <p>{closeFetcher.data.corrections.filter((c) => c.ok).length} inventory correction(s) applied.</p>
              )}
              {closeFetcher.data.corrections?.some((c) => c.error) && (
                <p>Some corrections failed — check the affected SKUs manually.</p>
              )}
            </Banner>
          )}

          <Card>
            <InlineStack gap="600">
              <BlockStack gap="050">
                <Text tone="subdued" variant="bodySm">Items</Text>
                <Text as="span">{cycleSession.items.length}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text tone="subdued" variant="bodySm">Discrepancies</Text>
                <Text as="span">{discrepancyCount}</Text>
              </BlockStack>
            </InlineStack>
          </Card>

          <Card>
            <BlockStack gap="0">
              {cycleSession.items.map((item) => (
                <ChecklistRow key={item.id} item={item} disabled={!isOpen} />
              ))}
            </BlockStack>
          </Card>

          {isOpen && (
            <Card>
              <BlockStack gap="300">
                <Checkbox
                  label="Apply corrections to Shopify inventory for mismatched counts"
                  checked={applyCorrections}
                  onChange={setApplyCorrections}
                />
                <InlineStack align="end">
                  <Button variant="primary" onClick={handleClose} loading={busy} disabled={busy}>
                    Close session
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          )}
        </BlockStack>
      </Page>
    </>
  );
}
