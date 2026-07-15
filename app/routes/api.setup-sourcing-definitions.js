import { authenticate } from "../shopify.server";

// One-time setup route (pattern: api.setup-supplier-definition.js) that
// creates the two variant metafield definitions Phase 2 relies on:
// inventory.sourcing_type (nos | repro | resale) and inventory.repro_settings
// (json: { run_size, moq, run_cost, tooling_notes }). Pinned so they're easy
// to find/edit from the Shopify admin metafields UI.
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  const definitions = [
    {
      name: "Sourcing Type",
      key: "sourcing_type",
      type: "single_line_text_field",
      validations: [{ name: "choices", value: JSON.stringify(["nos", "repro", "resale"]) }],
    },
    {
      name: "Repro Settings",
      key: "repro_settings",
      type: "json",
      validations: [],
    },
  ];

  const getDefinitionsQuery = `
    {
      metafieldDefinitions(first: 50, ownerType: PRODUCTVARIANT, namespace: "inventory") {
        edges {
          node {
            id
            key
          }
        }
      }
    }
  `;

  const getResponse = await admin.graphql(getDefinitionsQuery);
  const getData = await getResponse.json();
  const existingKeys = new Set(
    (getData.data?.metafieldDefinitions?.edges || []).map((e) => e.node.key)
  );

  const results = [];
  for (const def of definitions) {
    if (existingKeys.has(def.key)) {
      results.push({ key: def.key, skipped: true });
      continue;
    }

    const createMutation = `
      mutation CreateSourcingDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          metafieldDefinition {
            id
            key
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await admin.graphql(createMutation, {
      variables: {
        definition: {
          name: def.name,
          key: def.key,
          namespace: "inventory",
          type: def.type,
          ownerType: "PRODUCTVARIANT",
          pin: true,
          validations: def.validations,
        },
      },
    });
    const result = await response.json();
    results.push({ key: def.key, ...result.data?.metafieldDefinitionCreate });
  }

  return Response.json({ results });
}
