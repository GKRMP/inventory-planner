import { authenticate } from "../shopify.server";

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
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const fields = JSON.parse(form.get("fields"));

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
    return await response.json();
  }

  if (intent === "update") {
    const id = form.get("id");
    const fields = JSON.parse(form.get("fields"));

    const mutation = `
      mutation UpdateSupplier($id: ID!, $fields: [MetaobjectFieldInput!]!) {
        metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
          metaobject { id handle }
          userErrors { field message }
        }
      }
    `;

    const response = await admin.graphql(mutation, { variables: { id, fields } });
    return await response.json();
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
    return await response.json();
  }

  return { error: "Unknown intent" };
}