import express from "express";
import { shopify } from "../utils/shopify.js";
import { computeRiskRecord } from "../utils/riskModel.js";

const router = express.Router();

// GET /api/inventory-risk
router.get("/", async (req, res) => {
  try {
    const client = await shopify.api.clients.graphqlProxy(req, res);

    // 1. Fetch supplier_part records
    const supplierPartQuery = `
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

    const supplierPartResponse = await client.query({ data: supplierPartQuery });
    const supplierParts = supplierPartResponse.body.data.metaobjects.edges.map(edge => {
      const obj = { id: edge.node.id };
      edge.node.fields.forEach(f => (obj[f.key] = f.value));
      return obj;
    });

    // 2. Fetch suppliers
    const supplierQuery = `
      query {
        metaobjects(type: "supplier", first: 250) {
          edges {
            node {
              id
              fields { key value }
            }
          }
        }
      }
    `;

    const supplierResponse = await client.query({ data: supplierQuery });
    const suppliers = supplierResponse.body.data.metaobjects.edges.map(edge => {
      const obj = { id: edge.node.id };
      edge.node.fields.forEach(f => (obj[f.key] = f.value));
      return obj;
    });

    // 3. Fetch variants + metafields + inventory_item_id
    // (You will expand this with pagination)
    const variantQuery = `
      query {
        products(first: 50) {
          edges {
            node {
              title
              variants(first: 50) {
                edges {
                  node {
                    id
                    sku
                    inventoryItem {
                      id
                    }
                    metafield(namespace: "inventory_planning", key: "daily_demand_historical") {
                      value
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const variantResponse = await client.query({ data: variantQuery });

    const variants = [];
    variantResponse.body.data.products.edges.forEach(productEdge => {
      const product = productEdge.node;
      product.variants.edges.forEach(variantEdge => {
        const v = variantEdge.node;
        variants.push({
          variant_id: v.id,
          sku: v.sku,
          product_title: product.title,
          inventory_item_id: v.inventoryItem?.id,
          daily_demand: v.metafield?.value ? Number(v.metafield.value) : 0
        });
      });
    });

    // 4. Fetch inventory levels
    const inventoryLevels = {}; // inventory_item_id → quantity

    for (const v of variants) {
      if (!v.inventory_item_id) continue;

      const inventoryQuery = `
        query($id: ID!) {
          inventoryItem(id: $id) {
            inventoryLevels(first: 10) {
              edges {
                node {
                  available
                }
              }
            }
          }
        }
      `;

      const invResponse = await client.query({
        data: { query: inventoryQuery, variables: { id: v.inventory_item_id } }
      });

      const levels = invResponse.body.data.inventoryItem.inventoryLevels.edges;
      inventoryLevels[v.inventory_item_id] = levels.reduce(
        (sum, edge) => sum + edge.node.available,
        0
      );
    }

    // 5. Merge everything into risk records
    const riskRecords = supplierParts.map(sp => {
      const variant = variants.find(v => v.sku === sp.sku);
      const supplier = suppliers.find(s => s.id === sp.supplier);

      return computeRiskRecord(sp, variant, supplier, inventoryLevels);
    });

    res.json(riskRecords);
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

export default router;