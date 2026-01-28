# Supplier Import Guide

Since you have existing suppliers to import, here's the recommended approach for a one-time bulk import.

## Option 1: Web-Based Import (Recommended for One-Time Use)

This is the simplest method for importing your existing suppliers without writing additional code.

### Steps:

1. **Prepare your suppliers in JSON format:**

   Create a JSON file with your suppliers. Here's the template:

   ```json
   {
     "suppliers": [
       {
         "supplier_id": "SUP-001",
         "supplier_name": "Acme Corporation",
         "contact_name": "John Doe",
         "contact_name_2": "Jane Smith",
         "address": "123 Main Street",
         "address_2": "Suite 100",
         "city": "New York",
         "state": "NY",
         "zip": "10001",
         "country": "US",
         "phone_1": "555-1234",
         "phone_2": "555-5678",
         "email_1": "john@acme.com",
         "email_2": "jane@acme.com",
         "website": "https://acme.com",
         "notes": "Primary supplier for widgets"
       },
       {
         "supplier_id": "SUP-002",
         "supplier_name": "Global Supplies Inc",
         "contact_name": "Bob Johnson",
         "address": "456 Market St",
         "city": "San Francisco",
         "state": "CA",
         "zip": "94102",
         "country": "US",
         "phone_1": "415-555-9999",
         "email_1": "bob@globalsupplies.com",
         "website": "https://globalsupplies.com",
         "notes": "Secondary supplier"
       }
     ]
   }
   ```

   **Required fields:** `supplier_id`, `supplier_name`
   **Optional fields:** All others

2. **Access the import page:**

   After deploying your app:
   - Open your app in the Shopify admin
   - Navigate to: `/scripts/import-suppliers.html`
   - OR open `scripts/import-suppliers.html` in your browser while the app is running

3. **Import your suppliers:**
   - Copy your JSON data
   - Paste it into the text area
   - Click "Import Suppliers"
   - Wait for confirmation

4. **Verify:**
   - Go to the Suppliers page in your app
   - Verify all suppliers were imported correctly

## Option 2: CSV to JSON Conversion

If you have your suppliers in a CSV/Excel file:

### Convert CSV to JSON:

1. **Export from Excel as CSV** with this format:
   ```
   supplier_id,supplier_name,contact_name,address,city,state,zip,country,phone_1,email_1,website,notes
   SUP-001,Acme Corp,John Doe,123 Main St,New York,NY,10001,US,555-1234,john@acme.com,https://acme.com,Primary supplier
   ```

2. **Use an online CSV-to-JSON converter:**
   - https://csvjson.com/csv2json
   - Upload your CSV
   - Select "Array of objects" format
   - Download the JSON

3. **Wrap the array:**
   ```json
   {
     "suppliers": [
       /* paste the converted array here */
     ]
   }
   ```

4. **Use Option 1 above** to import the JSON

## Option 3: API Endpoint (For Programmatic Import)

If you prefer to script the import:

### Using curl:

```bash
curl -X POST https://your-app-domain.com/api/bulk-import-suppliers \
  -H "Content-Type: application/json" \
  -d @suppliers.json
```

### Using JavaScript/Node:

```javascript
const fs = require('fs');

const suppliers = JSON.parse(fs.readFileSync('suppliers.json', 'utf-8'));

fetch('https://your-app-domain.com/api/bulk-import-suppliers', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(suppliers),
})
  .then(res => res.json())
  .then(result => {
    console.log(`Imported: ${result.success.length}`);
    console.log(`Failed: ${result.failed.length}`);
  });
```

## Field Mapping Reference

| Field Name       | Description                     | Type   | Required | Example                |
|------------------|---------------------------------|--------|----------|------------------------|
| supplier_id      | Unique supplier identifier      | String | Yes      | SUP-001                |
| supplier_name    | Company/supplier name           | String | Yes      | Acme Corporation       |
| contact_name     | Primary contact person          | String | No       | John Doe               |
| contact_name_2   | Secondary contact person        | String | No       | Jane Smith             |
| address          | Street address line 1           | String | No       | 123 Main Street        |
| address_2        | Street address line 2           | String | No       | Suite 100              |
| city             | City                            | String | No       | New York               |
| state            | State (2-letter code)           | String | No       | NY                     |
| zip              | ZIP/Postal code                 | String | No       | 10001                  |
| country          | Country (2-letter code)         | String | No       | US                     |
| phone_1          | Primary phone number            | String | No       | 555-1234               |
| phone_2          | Secondary phone number          | String | No       | 555-5678               |
| email_1          | Primary email                   | String | No       | john@acme.com          |
| email_2          | Secondary email                 | String | No       | jane@acme.com          |
| website          | Company website URL             | String | No       | https://acme.com       |
| notes            | Additional notes                | String | No       | Primary supplier       |

## Recommendations

**For your one-time import:**

Since you have existing suppliers and need to import them once, I recommend:

1. **Use Option 1 (Web-Based Import)** - It's the simplest
2. Export your current suppliers to CSV/Excel
3. Convert to JSON format
4. Use the import HTML page to bulk import
5. Verify everything imported correctly
6. After import is complete, you won't need the import script again

**Why not build a permanent CSV importer:**

- This is a one-time migration
- The web-based approach is faster to execute
- No need to maintain import code in production
- The API endpoint can be removed after import if desired

## Troubleshooting

### Import fails with "Field definition does not exist"
- Go to Suppliers page
- Click "Setup Supplier Definition" button
- Wait for success message
- Try import again

### Some suppliers fail to import
- Check the error messages in the results
- Common issues:
  - Missing `supplier_id` or `supplier_name`
  - Duplicate `supplier_id` values
  - Invalid field values

### Import is slow
- The script adds a 100ms delay between suppliers to avoid rate limiting
- This is normal for large imports (100 suppliers = ~10 seconds)
- Don't refresh or close the page during import

### Need to re-import
- Delete existing suppliers from the Suppliers page
- Or use different supplier_id values (they must be unique)

## Post-Import Steps

After importing suppliers:

1. **Verify all suppliers** in the Suppliers page
2. **Go to Products page** to assign suppliers to variants
3. For each variant, set:
   - Supplier
   - Lead Time
   - Threshold
   - Daily Demand
4. **Check Dashboard** to see risk analysis

## Need Help?

If you encounter issues:
1. Check browser console (F12) for errors
2. Check server logs for detailed error messages
3. Verify JSON format is valid (use https://jsonlint.com)
4. Ensure all required fields are present
