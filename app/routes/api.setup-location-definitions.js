import { authenticate } from "../shopify.server";

// One-time setup route (pattern: api.setup-sourcing-definitions.js) that
// creates the two variant metafield definitions Phase 5 relies on:
// inventory.location (bin/shelf text) and inventory.cross_refs (list of
// normalized part numbers other systems know this part by).
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  const definitions = [
    { name: "Location", key: "location", type: "single_line_text_field" },
    { name: "Cross References", key: "cross_refs", type: "list.single_line_text_field" },
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
      mutation CreateLocationDefinition($definition: MetafieldDefinitionInput!) {
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
          validations: [],
        },
      },
    });
    const result = await response.json();
    results.push({ key: def.key, ...result.data?.metafieldDefinitionCreate });
  }

  return Response.json({ results });
}
