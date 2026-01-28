#!/usr/bin/env node

/**
 * Supplier Import Script
 *
 * Imports suppliers from CSV file into Shopify as metaobjects.
 *
 * Required environment variables in .env:
 *   SHOPIFY_STORE_URL - Your Shopify store URL (e.g., your-store.myshopify.com)
 *   SHOPIFY_ADMIN_ACCESS_TOKEN - Your Admin API access token
 *
 * Usage:
 *   node scripts/import-suppliers.js
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
  const suppliers = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || values.every(v => !v.trim())) continue;

    const supplier = {};
    headers.forEach((header, index) => {
      const value = values[index]?.trim() || '';
      if (value) {
        supplier[header] = value;
      }
    });

    // Only add if supplier has at least a name or ID
    if (supplier['Supplier Name'] || supplier['SupplierID']) {
      suppliers.push(supplier);
    }
  }

  return suppliers;
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

// Map CSV columns to metaobject field keys
function mapSupplierToFields(csvSupplier) {
  return {
    supplier_id: csvSupplier['SupplierID'] || '',
    supplier_name: csvSupplier['Supplier Name'] || '',
    contact_name: csvSupplier['Contact Name'] || '',
    contact_name_2: csvSupplier['Contact Name 2'] || '',
    address: csvSupplier['Address'] || '',
    address_2: csvSupplier['Address 2'] || '',
    city: csvSupplier['City'] || '',
    state: csvSupplier['State'] || '',
    zip: csvSupplier['ZIP'] || '',
    country: csvSupplier['Country'] || '',
    phone_1: csvSupplier['Phone'] || '',
    phone_2: csvSupplier['Phone 2'] || '',
    email_1: csvSupplier['Email'] || '',
    email_2: csvSupplier['Email 2'] || '',
    website: csvSupplier['Website'] || '',
    notes: csvSupplier['Notes'] || '',
  };
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

// Check if supplier metaobject definition exists
async function ensureSupplierDefinition() {
  const query = `
    {
      metaobjectDefinitions(first: 50) {
        edges {
          node {
            id
            type
            name
          }
        }
      }
    }
  `;

  const result = await shopifyGraphQL(query);
  const definitions = result.data?.metaobjectDefinitions?.edges || [];
  const supplierDef = definitions.find(e => e.node.type === 'supplier');

  if (!supplierDef) {
    console.log('\nSupplier metaobject definition not found. Creating it...');

    const createMutation = `
      mutation CreateSupplierDefinition {
        metaobjectDefinitionCreate(definition: {
          name: "Supplier"
          type: "supplier"
          fieldDefinitions: [
            { name: "Supplier ID", key: "supplier_id", type: "single_line_text_field" }
            { name: "Supplier Name", key: "supplier_name", type: "single_line_text_field" }
            { name: "Contact Name", key: "contact_name", type: "single_line_text_field" }
            { name: "Contact Name 2", key: "contact_name_2", type: "single_line_text_field" }
            { name: "Address", key: "address", type: "single_line_text_field" }
            { name: "Address 2", key: "address_2", type: "single_line_text_field" }
            { name: "City", key: "city", type: "single_line_text_field" }
            { name: "State", key: "state", type: "single_line_text_field" }
            { name: "Zip", key: "zip", type: "single_line_text_field" }
            { name: "Country", key: "country", type: "single_line_text_field" }
            { name: "Phone 1", key: "phone_1", type: "single_line_text_field" }
            { name: "Phone 2", key: "phone_2", type: "single_line_text_field" }
            { name: "Email 1", key: "email_1", type: "single_line_text_field" }
            { name: "Email 2", key: "email_2", type: "single_line_text_field" }
            { name: "Website", key: "website", type: "single_line_text_field" }
            { name: "Notes", key: "notes", type: "multi_line_text_field" }
          ]
        }) {
          metaobjectDefinition {
            id
            name
            type
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const createResult = await shopifyGraphQL(createMutation);

    if (createResult.data?.metaobjectDefinitionCreate?.userErrors?.length > 0) {
      const errors = createResult.data.metaobjectDefinitionCreate.userErrors;
      throw new Error(`Failed to create supplier definition: ${errors.map(e => e.message).join(', ')}`);
    }

    console.log('Supplier definition created successfully!');
    return createResult.data.metaobjectDefinitionCreate.metaobjectDefinition;
  }

  console.log('Supplier metaobject definition exists.');
  return supplierDef.node;
}

// Create a single supplier metaobject
async function createSupplier(supplier) {
  const fields = Object.entries(supplier)
    .filter(([key, value]) => value && String(value).trim() !== '')
    .map(([key, value]) => ({ key, value: String(value).trim() }));

  const mutation = `
    mutation CreateSupplier($fields: [MetaobjectFieldInput!]!) {
      metaobjectCreate(
        metaobject: {
          type: "supplier"
          fields: $fields
        }
      ) {
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

  return shopifyGraphQL(mutation, { fields });
}

// Mask the access token for display
function maskToken(token) {
  if (!token || token.length < 10) return '****';
  return token.substring(0, 8) + '...' + token.substring(token.length - 4);
}

// Main execution
async function main() {
  console.log('='.repeat(60));
  console.log('        SHOPIFY SUPPLIER IMPORT SCRIPT');
  console.log('='.repeat(60));
  console.log();

  // Load environment variables
  loadEnv();

  // Check required environment variables
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  if (!storeUrl) {
    console.error('Error: SHOPIFY_STORE_URL not set in .env file');
    console.error('Example: SHOPIFY_STORE_URL=your-store.myshopify.com');
    process.exit(1);
  }

  if (!accessToken) {
    console.error('Error: SHOPIFY_ADMIN_ACCESS_TOKEN not set in .env file');
    console.error('Example: SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxx');
    process.exit(1);
  }

  // Display configuration
  console.log('Configuration:');
  console.log('-'.repeat(40));
  console.log(`  Store URL:     ${storeUrl}`);
  console.log(`  Access Token:  ${maskToken(accessToken)}`);
  console.log();

  // Load and parse CSV
  const csvPath = path.join(__dirname, '..', 'tools', 'inventory-suppliers-import.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('Error: CSV file not found at', csvPath);
    process.exit(1);
  }

  const rawSuppliers = parseCSV(csvPath);
  console.log(`Found ${rawSuppliers.length} suppliers in CSV file.`);
  console.log();

  // Ask for confirmation
  const answer = await askConfirmation('Do you want to proceed with the import? (y/n): ');

  if (answer !== 'y' && answer !== 'yes') {
    console.log('\nImport cancelled.');
    process.exit(0);
  }

  console.log('\nStarting import...\n');

  try {
    // Ensure supplier definition exists
    await ensureSupplierDefinition();
    console.log();

    // Import suppliers
    const results = {
      success: [],
      failed: [],
    };

    for (let i = 0; i < rawSuppliers.length; i++) {
      const rawSupplier = rawSuppliers[i];
      const supplier = mapSupplierToFields(rawSupplier);
      const name = supplier.supplier_name || supplier.supplier_id || 'Unknown';

      process.stdout.write(`[${i + 1}/${rawSuppliers.length}] Importing "${name}"... `);

      try {
        const result = await createSupplier(supplier);

        if (result.data?.metaobjectCreate?.userErrors?.length > 0) {
          const errors = result.data.metaobjectCreate.userErrors;
          console.log(`FAILED - ${errors.map(e => e.message).join(', ')}`);
          results.failed.push({ name, error: errors.map(e => e.message).join(', ') });
        } else {
          console.log('OK');
          results.success.push({
            name,
            id: result.data.metaobjectCreate.metaobject.id
          });
        }
      } catch (error) {
        console.log(`ERROR - ${error.message}`);
        results.failed.push({ name, error: error.message });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('                    IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Total:     ${rawSuppliers.length}`);
    console.log(`  Success:   ${results.success.length}`);
    console.log(`  Failed:    ${results.failed.length}`);

    if (results.failed.length > 0) {
      console.log('\nFailed imports:');
      results.failed.forEach(f => {
        console.log(`  - ${f.name}: ${f.error}`);
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
