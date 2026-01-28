import { authenticate } from "../shopify.server";

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  // First, get the existing definition ID
  const getDefinitionQuery = `
    {
      metaobjectDefinitions(first: 10) {
        edges {
          node {
            id
            type
            fieldDefinitions {
              key
            }
          }
        }
      }
    }
  `;

  const getResponse = await admin.graphql(getDefinitionQuery);
  const getData = await getResponse.json();

  const supplierDef = getData.data.metaobjectDefinitions.edges.find(
    (e) => e.node.type === "supplier"
  );

  if (!supplierDef) {
    // Definition doesn't exist, create it
    const createMutation = `
      mutation CreateSupplierDefinition {
        metaobjectDefinitionCreate(definition: {
          name: "Supplier"
          type: "supplier"
          fieldDefinitions: [
            { name: "Supplier ID", key: "supplier_id", type: "single_line_text_field", required: true }
            { name: "Supplier Name", key: "supplier_name", type: "single_line_text_field", required: true }
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
            { name: "Website", key: "website", type: "url" }
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

    const response = await admin.graphql(createMutation);
    return await response.json();
  }

  // Definition exists, update it with missing fields
  const existingKeys = supplierDef.node.fieldDefinitions.map((f) => f.key);
  const requiredFields = [
    { name: "Supplier ID", key: "supplier_id", type: "single_line_text_field", required: true },
    { name: "Supplier Name", key: "supplier_name", type: "single_line_text_field", required: true },
    { name: "Contact Name", key: "contact_name", type: "single_line_text_field" },
    { name: "Contact Name 2", key: "contact_name_2", type: "single_line_text_field" },
    { name: "Address", key: "address", type: "single_line_text_field" },
    { name: "Address 2", key: "address_2", type: "single_line_text_field" },
    { name: "City", key: "city", type: "single_line_text_field" },
    { name: "State", key: "state", type: "single_line_text_field" },
    { name: "Zip", key: "zip", type: "single_line_text_field" },
    { name: "Country", key: "country", type: "single_line_text_field" },
    { name: "Phone 1", key: "phone_1", type: "single_line_text_field" },
    { name: "Phone 2", key: "phone_2", type: "single_line_text_field" },
    { name: "Email 1", key: "email_1", type: "single_line_text_field" },
    { name: "Email 2", key: "email_2", type: "single_line_text_field" },
    { name: "Website", key: "website", type: "url" },
    { name: "Notes", key: "notes", type: "multi_line_text_field" },
  ];

  const missingFields = requiredFields.filter((f) => !existingKeys.includes(f.key));

  if (missingFields.length === 0) {
    return {
      data: {
        metaobjectDefinitionUpdate: {
          metaobjectDefinition: supplierDef.node,
          userErrors: [],
        },
      },
    };
  }

  // Add missing fields one by one
  const results = [];
  for (const field of missingFields) {
    const updateMutation = `
      mutation UpdateSupplierDefinition {
        metaobjectDefinitionUpdate(
          id: "${supplierDef.node.id}"
          definition: {
            fieldDefinitions: [
              {
                create: {
                  name: "${field.name}"
                  key: "${field.key}"
                  type: "${field.type}"
                  ${field.required ? "required: true" : ""}
                }
              }
            ]
          }
        ) {
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

    const response = await admin.graphql(updateMutation);
    const result = await response.json();
    results.push(result);

    if (result.data?.metaobjectDefinitionUpdate?.userErrors?.length > 0) {
      return result;
    }
  }

  return results[results.length - 1] || { data: { metaobjectDefinitionUpdate: { userErrors: [] } } };
}
