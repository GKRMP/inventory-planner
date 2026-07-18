import { authenticate } from "../shopify.server";
import { writeThroughSupplierData, writeThroughSourcingType, writeThroughLocation, normalizeCrossRef } from "../services/sync.server";

const VALID_SOURCING_TYPES = ["nos", "repro", "resale"];

/**
 * Bulk Import Variant-Supplier Relationships API Endpoint
 *
 * Usage:
 *   POST /api/bulk-import-variant-suppliers
 *   Content-Type: application/json
 *
 * Body:
 *   {
 *     "variantSuppliers": [
 *       {
 *         "sku": "ABC-001",
 *         "supplier_id": "1001",
 *         "mpn": "MFG-12345",
 *         "is_primary": true,
 *         "lead_time": 14,
 *         "threshold": 10,
 *         "daily_demand": 2.5,
 *         "last_order_date": "2024-01-15",
 *         "last_order_cpu": 25.99,
 *         "last_order_quantity": 50,
 *         "notes": "Primary vendor"
 *       }
 *     ]
 *   }
 *
 * Notes:
 *   - Multiple entries with the same SKU will be grouped together
 *   - Each SKU can have multiple suppliers
 *   - MPN (Manufacturer Part Number) is the supplier's part number for the product
 */

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);

  try {
    const body = await request.json();
    const { variantSuppliers } = body;

    if (!variantSuppliers || !Array.isArray(variantSuppliers)) {
      return Response.json(
        { error: "Invalid request. Expected { variantSuppliers: [...] }" },
        { status: 400 }
      );
    }

    console.log(`Starting bulk import of ${variantSuppliers.length} variant-supplier relationships...`);

    // Group by SKU
    const groupedBySKU = {};
    const sourcingBySKU = {};
    const locationBySKU = {};
    for (const item of variantSuppliers) {
      const sku = item.sku;
      if (!sku) continue;

      if (!groupedBySKU[sku]) {
        groupedBySKU[sku] = [];
      }

      groupedBySKU[sku].push({
        supplier_id: item.supplier_id || "",
        mpn: item.mpn || "",
        is_primary: item.is_primary === true || item.is_primary === "true" || item.is_primary === "Y" || item.is_primary === "y",
        lead_time: parseInt(item.lead_time) || 0,
        threshold: parseInt(item.threshold) || 0,
        daily_demand: parseFloat(item.daily_demand) || 0,
        last_order_date: item.last_order_date || "",
        last_order_cpu: parseFloat(item.last_order_cpu) || 0,
        last_order_quantity: parseInt(item.last_order_quantity) || 0,
        notes: item.notes || "",
      });

      // sourcing_type is a per-SKU attribute — take the first non-empty
      // occurrence across that SKU's rows.
      const sourcingType = (item.sourcing_type || "").toLowerCase();
      if (!sourcingBySKU[sku] && VALID_SOURCING_TYPES.includes(sourcingType)) {
        sourcingBySKU[sku] = {
          sourcing_type: sourcingType,
          run_size: parseInt(item.repro_run_size) || 0,
          moq: parseInt(item.repro_moq) || 0,
          run_cost: parseFloat(item.repro_run_cost) || 0,
        };
      }

      // location/cross_refs are also per-SKU — take the first non-empty occurrence.
      if (!locationBySKU[sku] && (item.location || item.cross_refs?.length)) {
        locationBySKU[sku] = {
          location: (item.location || "").trim(),
          cross_refs: (item.cross_refs || []).map(normalizeCrossRef).filter(Boolean),
        };
      }
    }

    // Ensure only one primary per SKU
    for (const sku of Object.keys(groupedBySKU)) {
      const suppliers = groupedBySKU[sku];
      const primaryCount = suppliers.filter(s => s.is_primary).length;

      if (primaryCount === 0 && suppliers.length > 0) {
        suppliers[0].is_primary = true;
      } else if (primaryCount > 1) {
        let foundPrimary = false;
        for (let i = suppliers.length - 1; i >= 0; i--) {
          if (suppliers[i].is_primary) {
            if (foundPrimary) {
              suppliers[i].is_primary = false;
            }
            foundPrimary = true;
          }
        }
      }
    }

    const skuCount = Object.keys(groupedBySKU).length;
    console.log(`Grouped into ${skuCount} unique SKUs`);

    // Fetch all variants from Shopify
    console.log("Fetching variants from Shopify...");
    const variants = [];
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const query = `
        query GetVariants($cursor: String) {
          productVariants(first: 250, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                sku
                title
                product {
                  title
                }
              }
            }
          }
        }
      `;

      const response = await admin.graphql(query, { variables: { cursor } });
      const data = await response.json();

      if (data.errors) {
        throw new Error(`GraphQL error: ${data.errors.map(e => e.message).join(", ")}`);
      }

      const pageInfo = data.data.productVariants.pageInfo;
      const edges = data.data.productVariants.edges;

      for (const edge of edges) {
        if (edge.node.sku) {
          variants.push({
            id: edge.node.id,
            sku: edge.node.sku,
            title: edge.node.title,
            productTitle: edge.node.product.title,
          });
        }
      }

      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;
    }

    console.log(`Found ${variants.length} variants with SKUs`);

    // Create SKU to variant lookup
    const variantBySKU = {};
    for (const v of variants) {
      variantBySKU[v.sku] = v;
    }

    // Fetch all suppliers to validate supplier IDs
    console.log("Fetching suppliers...");
    const supplierQuery = `
      {
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

    const supplierResponse = await admin.graphql(supplierQuery);
    const supplierData = await supplierResponse.json();

    const supplierIDs = new Set();
    if (supplierData.data?.metaobjects?.edges) {
      for (const edge of supplierData.data.metaobjects.edges) {
        const idField = edge.node.fields.find(f => f.key === "supplier_id");
        if (idField?.value) {
          supplierIDs.add(idField.value);
        }
      }
    }

    console.log(`Found ${supplierIDs.size} suppliers`);

    // Process each SKU
    const results = {
      success: [],
      skipped: [],
      failed: [],
      totalSKUs: skuCount,
      totalRows: variantSuppliers.length,
    };

    const skus = Object.keys(groupedBySKU);
    for (const sku of skus) {
      const supplierDataList = groupedBySKU[sku];

      // Find variant
      const variant = variantBySKU[sku];
      if (!variant) {
        results.skipped.push({ sku, reason: "SKU not found in Shopify" });
        continue;
      }

      // Validate supplier IDs
      const invalidSuppliers = supplierDataList.filter(s => !supplierIDs.has(s.supplier_id));
      if (invalidSuppliers.length > 0) {
        results.skipped.push({
          sku,
          reason: `Unknown supplier IDs: ${invalidSuppliers.map(s => s.supplier_id).join(", ")}`
        });
        continue;
      }

      try {
        // Save to variant metafield
        const mutation = `
          mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields {
                id
                value
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const metafieldResponse = await admin.graphql(mutation, {
          variables: {
            metafields: [{
              ownerId: variant.id,
              namespace: "inventory",
              key: "supplier_data",
              type: "json",
              value: JSON.stringify(supplierDataList),
            }]
          }
        });

        const metafieldData = await metafieldResponse.json();

        if (metafieldData.data?.metafieldsSet?.userErrors?.length > 0) {
          results.failed.push({
            sku,
            error: metafieldData.data.metafieldsSet.userErrors.map(e => e.message).join(", ")
          });
        } else {
          try {
            await writeThroughSupplierData(session.shop, variant.id, JSON.stringify(supplierDataList));
          } catch (mirrorError) {
            console.error(`Mirror write-through failed for ${sku}:`, mirrorError);
          }

          const sourcing = sourcingBySKU[sku];
          if (sourcing) {
            try {
              const sourcingMetafields = [{
                ownerId: variant.id,
                namespace: "inventory",
                key: "sourcing_type",
                type: "single_line_text_field",
                value: sourcing.sourcing_type,
              }];
              if (sourcing.sourcing_type === "repro") {
                sourcingMetafields.push({
                  ownerId: variant.id,
                  namespace: "inventory",
                  key: "repro_settings",
                  type: "json",
                  value: JSON.stringify({
                    run_size: sourcing.run_size,
                    moq: sourcing.moq,
                    run_cost: sourcing.run_cost,
                  }),
                });
              }
              const sourcingResponse = await admin.graphql(mutation, {
                variables: { metafields: sourcingMetafields },
              });
              const sourcingData = await sourcingResponse.json();
              if (!sourcingData.data?.metafieldsSet?.userErrors?.length) {
                await writeThroughSourcingType(
                  session.shop,
                  variant.id,
                  sourcing.sourcing_type,
                  sourcing.sourcing_type === "repro" ? sourcing : null
                );
              }
            } catch (sourcingError) {
              console.error(`Sourcing type import failed for ${sku}:`, sourcingError);
            }
          }

          const location = locationBySKU[sku];
          if (location) {
            try {
              const locationResponse = await admin.graphql(mutation, {
                variables: {
                  metafields: [
                    {
                      ownerId: variant.id,
                      namespace: "inventory",
                      key: "location",
                      type: "single_line_text_field",
                      value: location.location,
                    },
                    {
                      ownerId: variant.id,
                      namespace: "inventory",
                      key: "cross_refs",
                      type: "list.single_line_text_field",
                      value: JSON.stringify(location.cross_refs),
                    },
                  ],
                },
              });
              const locationData = await locationResponse.json();
              if (!locationData.data?.metafieldsSet?.userErrors?.length) {
                await writeThroughLocation(session.shop, variant.id, location.location, location.cross_refs);
              }
            } catch (locationError) {
              console.error(`Location import failed for ${sku}:`, locationError);
            }
          }

          results.success.push({
            sku,
            variantId: variant.id,
            supplierCount: supplierDataList.length
          });
          console.log(`Imported: ${sku} (${supplierDataList.length} supplier(s))`);
        }
      } catch (error) {
        results.failed.push({ sku, error: error.message });
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`\nImport complete!`);
    console.log(`Success: ${results.success.length}`);
    console.log(`Skipped: ${results.skipped.length}`);
    console.log(`Failed: ${results.failed.length}`);

    return Response.json(results);
  } catch (error) {
    console.error("Bulk variant-supplier import error:", error);
    return Response.json(
      { error: "Import failed", message: error.message },
      { status: 500 }
    );
  }
}
