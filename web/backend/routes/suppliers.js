import { Router } from "express";
import { shopify } from "../shopify.js";

const router = Router();

// GET all suppliers
router.get("/", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

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

    const response = await client.query({ data: query });
    const suppliers = response.body.data.metaobjects.edges.map(e => e.node);

    res.json({ suppliers });
  } catch (error) {
    console.error("GET suppliers error:", error);
    res.status(500).json({ error: error.message });
  }
});

// CREATE supplier
router.post("/", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    const { fields } = req.body;

    const mutation = `
      mutation CreateSupplier($fields: [MetaobjectFieldInput!]!) {
        metaobjectCreate(metaobject: {
          type: "supplier",
          fields: $fields
        }) {
          metaobject {
            id
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await client.query({
      data: { query: mutation, variables: { fields } }
    });

    res.json(response.body.data.metaobjectCreate);
  } catch (error) {
    console.error("POST supplier error:", error);
    res.status(500).json({ error: error.message });
  }
});

// UPDATE supplier
router.put("/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    const { id } = req.params;
    const { fields } = req.body;

    const mutation = `
      mutation UpdateSupplier($id: ID!, $fields: [MetaobjectFieldInput!]!) {
        metaobjectUpdate(id: $id, metaobject: {
          fields: $fields
        }) {
          metaobject {
            id
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await client.query({
      data: { query: mutation, variables: { id, fields } }
    });

    res.json(response.body.data.metaobjectUpdate);
  } catch (error) {
    console.error("PUT supplier error:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE supplier
router.delete("/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    const { id } = req.params;

    const mutation = `
      mutation DeleteSupplier($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await client.query({
      data: { query: mutation, variables: { id } }
    });

    res.json(response.body.data.metaobjectDelete);
  } catch (error) {
    console.error("DELETE supplier error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;