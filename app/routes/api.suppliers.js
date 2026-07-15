import { authenticate } from "../shopify.server";
import { upsertSupplierMirror, deleteSupplierMirror } from "../services/sync.server";

// Mirror writes are best-effort: the metaobject mutation already committed
// by the time we get here, so a mirror failure should never fail the
// request — log it and let the nightly reconcile heal the drift.
async function mirrorSupplierWrite(shop, id, fields) {
  try {
    await upsertSupplierMirror(shop, { id, fields });
  } catch (error) {
    console.error(`Supplier mirror write-through failed for ${shop}:`, error);
  }
}

async function mirrorSupplierDelete(id) {
  try {
    await deleteSupplierMirror(id);
  } catch (error) {
    console.error(`Supplier mirror delete write-through failed:`, error);
  }
}

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const query = `
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

  const response = await admin.graphql(query);
  const data = await response.json();

  return {
    suppliers: data.data.metaobjects.edges.map(e => e.node),
  };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const fields = JSON.parse(form.get("fields"));
    const fieldVal = (key) => fields.find((f) => f.key === key)?.value?.trim() || "";
    const supplierId = fieldVal("supplier_id");
    const supplierName = fieldVal("supplier_name");

    // Required-field validation
    if (!supplierId || !supplierName) {
      return { error: "Supplier ID and Supplier Name are required." };
    }

    // Duplicate supplier_id check
    const existingQuery = `
      {
        metaobjects(type: "supplier", first: 250) {
          edges { node { fields { key value } } }
        }
      }
    `;
    const existingResponse = await admin.graphql(existingQuery);
    const existingData = await existingResponse.json();
    const duplicate = (existingData.data?.metaobjects?.edges || []).some((e) =>
      e.node.fields.some((f) => f.key === "supplier_id" && f.value === supplierId)
    );
    if (duplicate) {
      return { error: `A supplier with ID "${supplierId}" already exists.` };
    }

    const mutation = `
      mutation CreateSupplier($fields: [MetaobjectFieldInput!]!) {
        metaobjectCreate(metaobject: {
          type: "supplier",
          fields: $fields
        }) {
          metaobject { id handle }
          userErrors { field message }
        }
      }
    `;

    const response = await admin.graphql(mutation, { variables: { fields } });
    const result = await response.json();

    const createdId = result?.data?.metaobjectCreate?.metaobject?.id;
    if (createdId && !result?.data?.metaobjectCreate?.userErrors?.length) {
      await mirrorSupplierWrite(session.shop, createdId, fields);
    }

    return result;
  }

  if (intent === "update") {
    const id = form.get("id");
    const fields = JSON.parse(form.get("fields"));

    if (!id) {
      return { error: "Missing supplier reference for update." };
    }
    const nameVal = fields.find((f) => f.key === "supplier_name")?.value?.trim() || "";
    if (!nameVal) {
      return { error: "Supplier Name is required." };
    }

    const mutation = `
      mutation UpdateSupplier($id: ID!, $fields: [MetaobjectFieldInput!]!) {
        metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
          metaobject { id handle }
          userErrors { field message }
        }
      }
    `;

    const response = await admin.graphql(mutation, { variables: { id, fields } });
    const result = await response.json();

    if (!result?.data?.metaobjectUpdate?.userErrors?.length) {
      await mirrorSupplierWrite(session.shop, id, fields);
    }

    return result;
  }

  if (intent === "delete") {
    const id = form.get("id");

    const mutation = `
      mutation DeleteSupplier($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
          userErrors { field message }
        }
      }
    `;

    const response = await admin.graphql(mutation, { variables: { id } });
    const result = await response.json();

    if (result?.data?.metaobjectDelete?.deletedId) {
      await mirrorSupplierDelete(id);
    }

    return result;
  }

  return { error: "Unknown intent" };
}