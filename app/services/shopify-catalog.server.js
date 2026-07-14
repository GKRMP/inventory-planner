// Shared catalog fetch/transform logic used by app.jsx and api.products-loader.jsx.
// Uses the flat top-level `productVariants` connection instead of nested
// products(variants(metafields)) — the nested shape exceeds Shopify's 1,000
// point single-query cost cap once a store has more than ~40 products with
// several variants and metafields each.

const VARIANTS_PAGE_QUERY = `
  query GetVariantsPage($cursor: String, $query: String) {
    productVariants(first: 250, after: $cursor, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          sku
          title
          inventoryQuantity
          product {
            id
            title
            status
            vendor
          }
          metafield(namespace: "inventory", key: "supplier_data") {
            id
            namespace
            key
            value
          }
        }
      }
    }
  }
`;

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

const PRODUCT_COUNT_QUERY = `
  query GetProductCount($query: String) {
    productsCount(query: $query) {
      count
    }
  }
`;

// Preserves the variant shape existing consumers (enrichVariant, dashboard,
// products, report, purchase-orders) already expect: {id, sku, variantTitle,
// productTitle, productStatus, inventoryQuantity, metafields}.
export function transformVariant(node) {
  return {
    id: node.id,
    sku: node.sku || "",
    variantTitle: node.title || "",
    productTitle: node.product?.title || "Unknown",
    productStatus: node.product?.status || "ACTIVE",
    inventoryQuantity: node.inventoryQuantity || 0,
    metafields: node.metafield ? [node.metafield] : [],
  };
}

function assertNoErrors(data, queryName) {
  if (data.errors) {
    throw new Error(
      `${queryName} GraphQL errors: ${data.errors.map((e) => e.message).join("; ")}`
    );
  }
}

// Fetches a single page of variants. Throws on any GraphQL-level error so
// callers never mistake a failed page for "no more data".
export async function fetchVariantsPage(admin, { cursor = null, status = "ACTIVE" } = {}) {
  const query = status ? `product_status:${status.toLowerCase()}` : "";
  const response = await admin.graphql(VARIANTS_PAGE_QUERY, {
    variables: { cursor, query },
  });
  const data = await response.json();
  assertNoErrors(data, "productVariants");

  const connection = data.data?.productVariants;
  if (!connection) {
    throw new Error("Unexpected response shape from productVariants query");
  }

  return {
    variants: connection.edges.map((e) => transformVariant(e.node)),
    pageInfo: connection.pageInfo,
  };
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

// Approximate product count for progress display while paging variants.
export async function fetchApproxProductCount(admin, status = "ACTIVE") {
  const query = status ? `status:${status.toLowerCase()}` : "";
  const response = await admin.graphql(PRODUCT_COUNT_QUERY, { variables: { query } });
  const data = await response.json();
  assertNoErrors(data, "productsCount");
  return data.data?.productsCount?.count ?? null;
}
