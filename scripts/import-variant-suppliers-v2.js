#!/usr/bin/env node

/**
 * Variant-Supplier Relationship Import Script (V2 - OAuth)
 *
 * Imports supplier relationships for product variants from CSV file.
 * Uses OAuth session from Prisma database instead of API access token.
 *
 * Usage:
 *   node scripts/import-variant-suppliers-v2.js [csv-file]
 *
 * Default CSV: tools/variant-supplier-import.csv
 *
 * CSV Format:
 *   SKU,SupplierID,IsPrimary,LeadTime,Threshold,DailyDemand,LastOrderDate,LastOrderCPU,LastOrderQty,Notes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { getShopifyClient, maskToken } from '../tools/shopify-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CSV file
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  // Remove BOM if present
  const cleanContent = content.replace(/^\uFEFF/, '');
  const lines = cleanContent.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    throw new Error('CSV file is empty or has no data rows');
  }

  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || values.every(v => !v.trim())) continue;

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() || '';
    });

    // Only add if row has at least SKU and SupplierID
    if (row['SKU'] && row['SupplierID']) {
      rows.push(row);
    }
  }

  return rows;
}

// Parse a single CSV line, handling quoted fields
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);

  return values;
}

// Parse boolean values
function parseBool(value) {
  if (!value) return false;
  const lower = value.toString().toLowerCase().trim();
  return ['y', 'yes', '1', 'true'].includes(lower);
}

// Group rows by SKU
function groupBySKU(rows) {
  const grouped = {};

  for (const row of rows) {
    const sku = row['SKU'];
    if (!grouped[sku]) {
      grouped[sku] = [];
    }

    grouped[sku].push({
      supplier_id: row['SupplierID'],
      is_primary: parseBool(row['IsPrimary']),
      lead_time: parseInt(row['LeadTime']) || 0,
      threshold: parseInt(row['Threshold']) || 0,
      daily_demand: parseFloat(row['DailyDemand']) || 0,
      last_order_date: row['LastOrderDate'] || '',
      last_order_cpu: parseFloat(row['LastOrderCPU']) || 0,
      last_order_quantity: parseInt(row['LastOrderQty']) || 0,
      notes: row['Notes'] || '',
    });
  }

  // Ensure only one primary per SKU
  for (const sku of Object.keys(grouped)) {
    const suppliers = grouped[sku];
    const primaryCount = suppliers.filter(s => s.is_primary).length;

    if (primaryCount === 0 && suppliers.length > 0) {
      // No primary set, make first one primary
      suppliers[0].is_primary = true;
    } else if (primaryCount > 1) {
      // Multiple primaries, keep only the last one
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

  return grouped;
}

// Ask user for confirmation
async function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim());
    });
  });
}

// Fetch all variants with their SKUs
async function fetchAllVariants(graphql) {
  console.log('Fetching variants from Shopify...');

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

    const data = await graphql(query, { cursor });
    const { pageInfo, edges } = data.productVariants;

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

  console.log(`Found ${variants.length} variants with SKUs.`);
  return variants;
}

// Fetch all suppliers
async function fetchAllSuppliers(graphql) {
  console.log('Fetching suppliers from Shopify...');

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

  const data = await graphql(query);
  const suppliers = data.metaobjects.edges.map(e => {
    const fields = {};
    e.node.fields.forEach(f => {
      fields[f.key] = f.value;
    });
    return {
      id: e.node.id,
      handle: e.node.handle,
      supplier_id: fields.supplier_id,
      supplier_name: fields.supplier_name,
    };
  });

  console.log(`Found ${suppliers.length} suppliers.`);
  return suppliers;
}

// Save supplier data to variant metafield
async function saveVariantSupplierData(graphql, variantId, supplierData) {
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

  const data = await graphql(mutation, {
    metafields: [{
      ownerId: variantId,
      namespace: "inventory",
      key: "supplier_data",
      type: "json",
      value: JSON.stringify(supplierData),
    }]
  });

  if (data.metafieldsSet?.userErrors?.length > 0) {
    throw new Error(data.metafieldsSet.userErrors.map(e => e.message).join(', '));
  }

  return data;
}

// Main execution
async function main() {
  console.log('='.repeat(60));
  console.log('    VARIANT-SUPPLIER RELATIONSHIP IMPORT SCRIPT (V2)');
  console.log('='.repeat(60));
  console.log();

  // Determine CSV file path
  const csvArg = process.argv[2];
  const csvPath = csvArg
    ? path.resolve(csvArg)
    : path.join(__dirname, '..', 'tools', 'variant-supplier-import.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('Error: CSV file not found at', csvPath);
    console.error('\nUsage: node scripts/import-variant-suppliers-v2.js [csv-file]');
    console.error('\nDefault location: tools/variant-supplier-import.csv');
    process.exit(1);
  }

  console.log(`CSV File: ${csvPath}`);
  console.log();

  // Parse CSV
  const rows = parseCSV(csvPath);
  const groupedData = groupBySKU(rows);
  const skuCount = Object.keys(groupedData).length;

  console.log(`Found ${rows.length} rows for ${skuCount} unique SKUs.`);
  console.log();

  // Show preview
  console.log('Preview of import data:');
  console.log('-'.repeat(40));
  let previewCount = 0;
  for (const [sku, suppliers] of Object.entries(groupedData)) {
    if (previewCount >= 5) {
      console.log(`  ... and ${skuCount - 5} more SKUs`);
      break;
    }
    console.log(`  ${sku}: ${suppliers.length} supplier(s)`);
    suppliers.forEach(s => {
      console.log(`    - ${s.supplier_id}${s.is_primary ? ' (Primary)' : ''}`);
    });
    previewCount++;
  }
  console.log();

  // Get Shopify client using OAuth from Prisma
  console.log('Connecting to Shopify (using OAuth session)...');
  let graphql, shop, accessToken;
  try {
    const client = await getShopifyClient();
    graphql = client.graphql;
    shop = client.shop;
    accessToken = client.accessToken;
  } catch (error) {
    console.error('Error connecting to Shopify:', error.message);
    console.error('\nMake sure:');
    console.error('  1. The DATABASE_URL is set in .env');
    console.error('  2. The app has been installed on a shop');
    console.error('  3. You have run the app at least once to create a session');
    process.exit(1);
  }

  console.log(`Connected to: ${shop}`);
  console.log(`Access Token: ${maskToken(accessToken)}`);
  console.log();

  // Ask for confirmation
  const answer = await askConfirmation('Do you want to proceed with the import? (y/n): ');

  if (answer !== 'y' && answer !== 'yes') {
    console.log('\nImport cancelled.');
    process.exit(0);
  }

  console.log('\nStarting import...\n');

  try {
    // Fetch existing data
    const [variants, suppliers] = await Promise.all([
      fetchAllVariants(graphql),
      fetchAllSuppliers(graphql),
    ]);

    // Create lookup maps
    const variantBySKU = {};
    for (const v of variants) {
      variantBySKU[v.sku] = v;
    }

    const supplierByID = {};
    for (const s of suppliers) {
      supplierByID[s.supplier_id] = s;
    }

    console.log();

    // Process imports
    const results = {
      success: [],
      skipped: [],
      failed: [],
    };

    const skus = Object.keys(groupedData);
    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i];
      const supplierDataList = groupedData[sku];

      process.stdout.write(`[${i + 1}/${skuCount}] Processing SKU "${sku}"... `);

      // Find variant
      const variant = variantBySKU[sku];
      if (!variant) {
        console.log('SKIPPED - SKU not found in Shopify');
        results.skipped.push({ sku, reason: 'SKU not found in Shopify' });
        continue;
      }

      // Validate supplier IDs
      const invalidSuppliers = supplierDataList.filter(s => !supplierByID[s.supplier_id]);
      if (invalidSuppliers.length > 0) {
        console.log(`SKIPPED - Unknown supplier IDs: ${invalidSuppliers.map(s => s.supplier_id).join(', ')}`);
        results.skipped.push({
          sku,
          reason: `Unknown supplier IDs: ${invalidSuppliers.map(s => s.supplier_id).join(', ')}`
        });
        continue;
      }

      try {
        await saveVariantSupplierData(graphql, variant.id, supplierDataList);
        console.log(`OK (${supplierDataList.length} supplier(s))`);
        results.success.push({
          sku,
          variantId: variant.id,
          supplierCount: supplierDataList.length
        });
      } catch (error) {
        console.log(`FAILED - ${error.message}`);
        results.failed.push({ sku, error: error.message });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('                    IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Total SKUs:    ${skuCount}`);
    console.log(`  Success:       ${results.success.length}`);
    console.log(`  Skipped:       ${results.skipped.length}`);
    console.log(`  Failed:        ${results.failed.length}`);

    if (results.skipped.length > 0) {
      console.log('\nSkipped imports:');
      results.skipped.forEach(s => {
        console.log(`  - ${s.sku}: ${s.reason}`);
      });
    }

    if (results.failed.length > 0) {
      console.log('\nFailed imports:');
      results.failed.forEach(f => {
        console.log(`  - ${f.sku}: ${f.error}`);
      });
    }

    console.log('\nImport complete!');

  } catch (error) {
    console.error('\nFatal error:', error.message);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
