#!/usr/bin/env node

/**
 * Variant-Supplier Relationship Import Script
 *
 * Imports supplier relationships for product variants from CSV file.
 * Supports multiple suppliers per SKU.
 *
 * Required environment variables in .env:
 *   SHOPIFY_STORE_URL - Your Shopify store URL (e.g., your-store.myshopify.com)
 *   SHOPIFY_ADMIN_ACCESS_TOKEN - Your Admin API access token
 *
 * Usage:
 *   node scripts/import-variant-suppliers.js [csv-file]
 *
 * Default CSV: tools/variant-supplier-import.csv
 *
 * CSV Format:
 *   SKU,SupplierID,MPN,IsPrimary,LeadTime,Threshold,DailyDemand,LastOrderDate,LastOrderCPU,LastOrderQty,Notes
 *
 * Notes:
 *   - SKU must match a variant SKU in your Shopify store
 *   - SupplierID must match a supplier_id from your suppliers metaobjects
 *   - IsPrimary: Y or N (or Yes/No, 1/0, true/false)
 *   - Multiple rows with the same SKU will create multiple supplier relationships
 *   - If multiple suppliers for same SKU have IsPrimary=Y, only the last one will be primary
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');

  if (!fs.existsSync(envPath)) {
    console.error('Error: .env file not found at', envPath);
    console.error('\nPlease create a .env file with:');
    console.error('  SHOPIFY_STORE_URL=your-store.myshopify.com');
    console.error('  SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxx');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  }
}

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
      mpn: row['MPN'] || '',
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

// Make GraphQL request to Shopify Admin API
async function shopifyGraphQL(query, variables = {}) {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  const url = `https://${storeUrl}/admin/api/2024-10/graphql.json`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphQL request failed: ${response.status} - ${text}`);
  }

  return response.json();
}

// Fetch all variants with their SKUs
async function fetchAllVariants() {
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

    const result = await shopifyGraphQL(query, { cursor });

    if (result.errors) {
      throw new Error(`GraphQL error: ${result.errors.map(e => e.message).join(', ')}`);
    }

    const pageInfo = result.data.productVariants.pageInfo;
    const edges = result.data.productVariants.edges;

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
async function fetchAllSuppliers() {
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

  const result = await shopifyGraphQL(query);

  if (result.errors) {
    throw new Error(`GraphQL error: ${result.errors.map(e => e.message).join(', ')}`);
  }

  const suppliers = result.data.metaobjects.edges.map(e => {
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
async function saveVariantSupplierData(variantId, supplierData) {
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

  const result = await shopifyGraphQL(mutation, {
    metafields: [{
      ownerId: variantId,
      namespace: "inventory",
      key: "supplier_data",
      type: "json",
      value: JSON.stringify(supplierData),
    }]
  });

  if (result.data?.metafieldsSet?.userErrors?.length > 0) {
    throw new Error(result.data.metafieldsSet.userErrors.map(e => e.message).join(', '));
  }

  return result;
}

// Mask the access token for display
function maskToken(token) {
  if (!token || token.length < 10) return '****';
  return token.substring(0, 8) + '...' + token.substring(token.length - 4);
}

// Main execution
async function main() {
  console.log('='.repeat(60));
  console.log('    VARIANT-SUPPLIER RELATIONSHIP IMPORT SCRIPT');
  console.log('='.repeat(60));
  console.log();

  // Load environment variables
  loadEnv();

  // Check required environment variables
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  if (!storeUrl) {
    console.error('Error: SHOPIFY_STORE_URL not set in .env file');
    process.exit(1);
  }

  if (!accessToken) {
    console.error('Error: SHOPIFY_ADMIN_ACCESS_TOKEN not set in .env file');
    process.exit(1);
  }

  // Display configuration
  console.log('Configuration:');
  console.log('-'.repeat(40));
  console.log(`  Store URL:     ${storeUrl}`);
  console.log(`  Access Token:  ${maskToken(accessToken)}`);
  console.log();

  // Determine CSV file path
  const csvArg = process.argv[2];
  const csvPath = csvArg
    ? path.resolve(csvArg)
    : path.join(__dirname, '..', 'tools', 'variant-supplier-import.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('Error: CSV file not found at', csvPath);
    console.error('\nUsage: node scripts/import-variant-suppliers.js [csv-file]');
    console.error('\nDefault location: tools/variant-supplier-import.csv');
    console.error('\nSee tools/variant-supplier-import-template.csv for format.');
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
      fetchAllVariants(),
      fetchAllSuppliers(),
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
        await saveVariantSupplierData(variant.id, supplierDataList);
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
