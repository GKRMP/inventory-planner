import express from "express";
import { shopify } from "../utils/shopify.js";

const router = express.Router();

// GET /api/supplier-parts
router.get("/", async (req, res) => {
  try {
    const client = await shopify.api.clients.graphqlProxy(req, res);

    const query = `
      query {
        metaobjects(type: "supplier_part", first: 250) {
          edges {
            node {
              id
              fields { key value }
            }
          }
        }
      }
    `;

    const response = await client.query({ data: query });

    const records = response.body.data.metaobjects.edges.map(edge => {
      const obj = { id: edge.node.id };
      edge.node.fields.forEach(f => (obj[f.key] = f.value));
      return obj;
    });

    res.json(records);
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// POST /api/supplier-parts
router.post("/", async (req, res) => {
  try {
    const client = await shopify.api.clients.graphqlProxy(req, res);
    const data = req.body;

    if (!data.product || !data.supplier || !data.lead_time_days) {
      return res.status(400).json({ error: true, message: "Missing required fields" });
    }

    const mutation = `
      mutation CreateSupplierPart($fields: [MetaobjectFieldInput!]!) {
        metaobjectCreate(metaobject: {
          type: "supplier_part",
          fields: $fields
        }) {
          metaobject { id }
          userErrors { field message }
        }
      }
    `;

    const fields = Object.entries(data).map(([key, value]) => ({
      key,
      value
    }));

    const response = await client.query({
      data: { query: mutation, variables: { fields } }
    });

    res.json(response.body.data.metaobjectCreate);
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// PUT /api/supplier-parts/:id
router.put("/:id", async (req, res) => {
  try {
    const client = await shopify.api.clients.graphqlProxy(req, res);
    const { id } = req.params;
    const data = req.body;

    const mutation = `
      mutation UpdateSupplierPart($id: ID!, $fields: [MetaobjectFieldInput!]!) {
        metaobjectUpdate(id: $id, metaobject: {
          fields: $fields
        }) {
          metaobject { id }
          userErrors { field message }
        }
      }
    `;

    const fields = Object.entries(data).map(([key, value]) => ({
      key,
      value
    }));

    const response = await client.query({
      data: { query: mutation, variables: { id, fields } }
    });

    res.json(response.body.data.metaobjectUpdate);
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// DELETE /api/supplier-parts/:id
router.delete("/:id", async (req, res) => {
  try {
    const client = await shopify.api.clients.graphqlProxy(req, res);
    const { id } = req.params;

    const mutation = `
      mutation DeleteSupplierPart($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
          userErrors { field message }
        }
      }
    `;

    const response = await client.query({
      data: { query: mutation, variables: { id } }
    });

    res.json(response.body.data.metaobjectDelete);
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

export default router;