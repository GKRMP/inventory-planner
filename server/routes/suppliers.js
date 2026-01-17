import express from "express";
import { shopify } from "../utils/shopify.js";

const router = express.Router();

// GET /api/suppliers
router.get("/", async (req, res) => {
  try {
    const client = await shopify.api.clients.graphqlProxy(req, res);

    const query = `
      query {
        metaobjects(type: "supplier", first: 250) {
          edges {
            node {
              id
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

    const suppliers = response.body.data.metaobjects.edges.map(edge => {
      const obj = { id: edge.node.id };
      edge.node.fields.forEach(f => (obj[f.key] = f.value));
      return obj;
    });

    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

// POST /api/suppliers
router.post("/", async (req, res) => {
  try {
    const client = await shopify.api.clients.graphqlProxy(req, res);
    const data = req.body;

    if (!data.supplier_id || !data.supplier_name) {
      return res.status(400).json({ error: true, message: "Missing required fields" });
    }

    const mutation = `
      mutation CreateSupplier($fields: [MetaobjectFieldInput!]!) {
        metaobjectCreate(metaobject: {
          type: "supplier",
          fields: $fields
        }) {
          metaobject {
            id
          }
          userErrors {
            field
            message
          }
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

// PUT /api/suppliers/:id
router.put("/:id", async (req, res) => {
  try {
    const client = await shopify.api.clients.graphqlProxy(req, res);
    const { id } = req.params;
    const data = req.body;

    const mutation = `
      mutation UpdateSupplier($id: ID!, $fields: [MetaobjectFieldInput!]!) {
        metaobjectUpdate(id: $id, metaobject: {
          fields: $fields
        }) {
          metaobject {
            id
          }
          userErrors {
            field
            message
          }
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

// DELETE /api/suppliers/:id
router.delete("/:id", async (req, res) => {
  try {
    const client = await shopify.api.clients.graphqlProxy(req, res);
    const { id } = req.params;

    // Check if supplier is referenced by supplier_part
    const checkQuery = `
      query($id: ID!) {
        metaobjects(type: "supplier_part", first: 1, query: $id) {
          edges { node { id } }
        }
      }
    `;

    const check = await client.query({
      data: { query: checkQuery, variables: { id } }
    });

    if (check.body.data.metaobjects.edges.length > 0) {
      return res.status(400).json({
        error: true,
        message: "Cannot delete supplier: linked SKUs exist"
      });
    }

    const mutation = `
      mutation DeleteSupplier($id: ID!) {
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