import { authenticate } from "../shopify.server";

/**
 * Bulk Import Suppliers API Endpoint
 *
 * Usage:
 *   POST /api/bulk-import-suppliers
 *   Content-Type: application/json
 *
 * Body:
 *   {
 *     "suppliers": [
 *       {
 *         "supplier_id": "SUP-001",
 *         "supplier_name": "Acme Corp",
 *         "contact_name": "John Doe",
 *         "phone_1": "555-1234",
 *         "email_1": "john@acme.com",
 *         ... other fields
 *       }
 *     ]
 *   }
 */

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    const body = await request.json();
    const { suppliers } = body;

    if (!suppliers || !Array.isArray(suppliers)) {
      return Response.json(
        { error: "Invalid request. Expected { suppliers: [...] }" },
        { status: 400 }
      );
    }

    console.log(`Starting bulk import of ${suppliers.length} suppliers...`);

    const results = {
      success: [],
      failed: [],
      total: suppliers.length,
    };

    // Import each supplier
    for (const supplier of suppliers) {
      try {
        // Build fields array, filtering out empty values
        const fields = Object.entries(supplier)
          .filter(([key, value]) => value && String(value).trim() !== "")
          .map(([key, value]) => ({ key, value: String(value).trim() }));

        // Check required fields
        const hasId = fields.some((f) => f.key === "supplier_id");
        const hasName = fields.some((f) => f.key === "supplier_name");

        if (!hasId || !hasName) {
          results.failed.push({
            supplier: supplier.supplier_name || "Unknown",
            error: "Missing required fields: supplier_id and supplier_name",
          });
          continue;
        }

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

        const response = await admin.graphql(mutation, {
          variables: { fields },
        });
        const data = await response.json();

        if (data.data?.metaobjectCreate?.userErrors?.length > 0) {
          results.failed.push({
            supplier: supplier.supplier_name,
            error: data.data.metaobjectCreate.userErrors
              .map((e) => e.message)
              .join(", "),
          });
        } else {
          results.success.push({
            supplier: supplier.supplier_name,
            id: data.data.metaobjectCreate.metaobject.id,
          });
          console.log(`✓ Imported: ${supplier.supplier_name}`);
        }

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        results.failed.push({
          supplier: supplier.supplier_name || "Unknown",
          error: error.message,
        });
      }
    }

    console.log(`\nImport complete!`);
    console.log(`Success: ${results.success.length}`);
    console.log(`Failed: ${results.failed.length}`);

    return Response.json(results);
  } catch (error) {
    console.error("Bulk import error:", error);
    return Response.json(
      { error: "Import failed", message: error.message },
      { status: 500 }
    );
  }
}
