import { useState } from "react";
import { Page, Card, IndexTable, Badge, BlockStack, InlineStack, TextField, Button, Banner, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { createSession, listSessions } from "../services/cycle-counts.server";
import AppNavigation from "../components/AppNavigation";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const sessions = await listSessions(session.shop);
  return { sessions };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const body = await request.json();
  return Response.json(await createSession(session.shop, body));
}

export default function CycleCountsPage() {
  const { sessions } = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [name, setName] = useState("");
  const [binLocation, setBinLocation] = useState("");
  const [search, setSearch] = useState("");
  const busy = fetcher.state !== "idle";

  const handleCreate = () => {
    fetcher.submit(JSON.stringify({ name, binLocation, search }), {
      method: "post",
      encType: "application/json",
    });
  };

  return (
    <>
      <TitleBar title="Cycle Counts" />
      <Page title="Cycle counts" fullWidth>
        <BlockStack gap="400">
          <AppNavigation />

          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" as="h3">Start a new count</Text>
              {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}
              <InlineStack gap="300" wrap={false}>
                <div style={{ flex: 1 }}>
                  <TextField label="Name" value={name} onChange={setName} autoComplete="off" placeholder="e.g. Bin A3 walk" />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField label="Bin / location" value={binLocation} onChange={setBinLocation} autoComplete="off" />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField label="Search (SKU/title)" value={search} onChange={setSearch} autoComplete="off" />
                </div>
              </InlineStack>
              <InlineStack align="end">
                <Button
                  variant="primary"
                  onClick={handleCreate}
                  disabled={busy || (!binLocation.trim() && !search.trim())}
                  loading={busy}
                >
                  Start count
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "session", plural: "sessions" }}
              itemCount={sessions.length}
              headings={[
                { title: "Name" },
                { title: "Status" },
                { title: "Items" },
                { title: "Counted" },
                { title: "Discrepancies" },
                { title: "Created" },
              ]}
              selectable={false}
              onRowClick={(id) => navigate(`/app/cycle-counts/${id}`)}
            >
              {sessions.map((s, index) => (
                <IndexTable.Row id={s.id} key={s.id} position={index}>
                  <IndexTable.Cell>
                    <Text fontWeight="semibold" as="span">{s.name}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={s.status === "OPEN" ? "info" : "success"}>{s.status}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{s.itemCount}</IndexTable.Cell>
                  <IndexTable.Cell>{s.countedCount}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {s.discrepancyCount > 0 ? <Badge tone="warning">{s.discrepancyCount}</Badge> : "0"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{new Date(s.createdAt).toLocaleDateString()}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </BlockStack>
      </Page>
    </>
  );
}
