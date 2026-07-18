import { useEffect, useState } from "react";
import { Page, Card, BlockStack, InlineStack, TextField, Button, Banner, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { upsertVariantMirror } from "../services/sync.server";
import { adjustInventoryQuantity } from "../services/inventory.server";

async function uploadStagedFile(admin, file) {
  const stagedResp = await admin.graphql(
    `
      mutation IntakeStagedUpload($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        input: [{ filename: file.name, mimeType: file.type || "image/jpeg", resource: "PRODUCT_IMAGE", httpMethod: "POST" }],
      },
    }
  );
  const stagedData = await stagedResp.json();
  const target = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) return null;

  // Barn wifi is flaky — one retry before giving up and falling back to a
  // photo-less product rather than failing the whole intake.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const uploadForm = new FormData();
      for (const p of target.parameters) uploadForm.append(p.name, p.value);
      uploadForm.append("file", file);
      const uploadResp = await fetch(target.url, { method: "POST", body: uploadForm });
      if (uploadResp.ok) return target.resourceUrl;
    } catch (error) {
      console.error("Staged upload attempt failed:", error);
    }
  }
  return null;
}

export async function loader({ request }) {
  await authenticate.admin(request);
  return {};
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const title = (formData.get("title") || "").toString().trim();
  const binLocation = (formData.get("binLocation") || "").toString().trim();
  const sku = (formData.get("sku") || "").toString().trim();
  const qty = Math.max(0, parseInt(formData.get("qty"), 10) || 0);
  const photo = formData.get("photo");
  const hasPhoto = photo instanceof File && photo.size > 0;

  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });

  let resourceUrl = null;
  let photoSkipped = false;
  if (hasPhoto) {
    resourceUrl = await uploadStagedFile(admin, photo);
    photoSkipped = !resourceUrl;
  }

  const createResp = await admin.graphql(
    `
      mutation IntakeProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
        productCreate(product: $product, media: $media) {
          product {
            id
            variants(first: 1) {
              nodes { id inventoryItem { id } }
            }
          }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        product: { title, status: "DRAFT" },
        media: resourceUrl ? [{ originalSource: resourceUrl, mediaContentType: "IMAGE", alt: title }] : undefined,
      },
    }
  );
  const createData = await createResp.json();
  const createErrors = createData.data?.productCreate?.userErrors || [];
  if (createErrors.length) {
    return Response.json({ error: createErrors.map((e) => e.message).join("; ") }, { status: 400 });
  }

  const product = createData.data.productCreate.product;
  const variant = product.variants.nodes[0];

  const metafields = [{ namespace: "inventory", key: "sourcing_type", type: "single_line_text_field", value: "nos" }];
  if (binLocation) {
    metafields.push({ namespace: "inventory", key: "location", type: "single_line_text_field", value: binLocation });
  }

  const updateResp = await admin.graphql(
    `
      mutation IntakeVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id sku }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        productId: product.id,
        variants: [{ id: variant.id, sku: sku || undefined, metafields }],
      },
    }
  );
  const updateData = await updateResp.json();
  const updateErrors = updateData.data?.productVariantsBulkUpdate?.userErrors || [];
  if (updateErrors.length) {
    console.error(`Intake variant update failed for ${variant.id}:`, updateErrors);
  }

  let inventoryWarning = null;
  if (qty > 0) {
    const syncState = await prisma.syncState.findUnique({ where: { shop } });
    if (syncState?.locationId) {
      const adjustment = await adjustInventoryQuantity(admin, {
        inventoryItemId: variant.inventoryItem.id,
        locationId: syncState.locationId,
        delta: qty,
        reason: "restock",
        referenceDocumentUri: `gid://rmp-inventory-planner/Intake/${product.id}`,
      });
      if (adjustment.error) inventoryWarning = adjustment.error;
    } else {
      inventoryWarning = "No location on file yet — run a sync, then set the quantity manually";
    }
  }

  try {
    await upsertVariantMirror(shop, {
      id: variant.id,
      sku: sku || null,
      title: null,
      inventoryQuantity: inventoryWarning ? 0 : qty,
      inventoryItemId: variant.inventoryItem.id,
      product: { id: product.id, title, status: "DRAFT", vendor: null },
      sourcingType: "nos",
      binLocation: binLocation || null,
      crossRefsRaw: null,
    });
  } catch (error) {
    console.error(`Intake mirror write-through failed for ${shop}:`, error);
  }

  return Response.json({ ok: true, productId: product.id, title, photoSkipped, inventoryWarning });
}

export default function IntakePage() {
  const fetcher = useFetcher();
  const [title, setTitle] = useState("");
  const [binLocation, setBinLocation] = useState("");
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("1");
  const [photo, setPhoto] = useState(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setTitle("");
      setBinLocation("");
      setSku("");
      setQty("1");
      setPhoto(null);
    }
  }, [fetcher.state, fetcher.data]);

  const handleSubmit = () => {
    const fd = new FormData();
    fd.append("title", title);
    fd.append("binLocation", binLocation);
    fd.append("sku", sku);
    fd.append("qty", qty);
    if (photo) fd.append("photo", photo);
    fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  };

  return (
    <>
      <TitleBar title="Intake" />
      <Page title="Barn find intake" narrowWidth>
        <BlockStack gap="400">
          {fetcher.data?.ok && (
            <Banner tone="success" title={`Saved "${fetcher.data.title}" as a draft product`}>
              {fetcher.data.photoSkipped && <p>The photo upload failed — product was saved without it.</p>}
              {fetcher.data.inventoryWarning && <p>{fetcher.data.inventoryWarning}</p>}
            </Banner>
          )}
          {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}

          <Card>
            <BlockStack gap="400">
              <TextField label="Title" value={title} onChange={setTitle} autoComplete="off" requiredIndicator />
              <TextField label="Bin / location" value={binLocation} onChange={setBinLocation} autoComplete="off" />
              <TextField label="SKU (optional)" value={sku} onChange={setSku} autoComplete="off" />
              <TextField label="Quantity" type="number" min={0} value={qty} onChange={setQty} autoComplete="off" />

              <BlockStack gap="100">
                <Text variant="bodyMd" as="label">Photo</Text>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => setPhoto(e.target.files?.[0] || null)}
                />
                {photo && <Text variant="bodySm" tone="subdued" as="p">{photo.name}</Text>}
              </BlockStack>

              <InlineStack align="end">
                <Button variant="primary" onClick={handleSubmit} disabled={!title || busy} loading={busy}>
                  {busy ? "Saving…" : "Save to Shopify"}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </BlockStack>
      </Page>
    </>
  );
}
