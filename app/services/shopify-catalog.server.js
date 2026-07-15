// Shared catalog fetch/transform logic used by the Postgres bulk sync
// (app/services/sync.server.js) to build its per-shop mirror.

const SUPPLIERS_QUERY = `
  query GetSuppliers($cursor: String) {
    metaobjects(type: "supplier", first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
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

function assertNoErrors(data, queryName) {
  if (data.errors) {
    throw new Error(
      `${queryName} GraphQL errors: ${data.errors.map((e) => e.message).join("; ")}`
    );
  }
}

// Fetches every supplier metaobject, paging past Shopify's 250-per-request cap.
export async function fetchAllSuppliers(admin) {
  let suppliers = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(SUPPLIERS_QUERY, { variables: { cursor } });
    const data = await response.json();
    assertNoErrors(data, "metaobjects");

    const connection = data.data?.metaobjects;
    if (!connection) {
      throw new Error("Unexpected response shape from metaobjects query");
    }

    suppliers = suppliers.concat(connection.edges.map((e) => e.node));
    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
  }

  return suppliers;
}
