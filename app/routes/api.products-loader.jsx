import { authenticate } from "../shopify.server";

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "loadAllProducts") {
    const statusFilter = formData.get("statusFilter") || "ACTIVE";

    // Fetch ALL products with pagination
    let allVariants = [];
    let hasNextPage = true;
    let cursor = null;
    let pageCount = 0;
    const maxPages = 50;

    // Build query filter
    const queryFilter = statusFilter ? `status:${statusFilter}` : "";

    while (hasNextPage && pageCount < maxPages) {
      try {
        const productsQuery = `
          query GetProducts($cursor: String, $query: String) {
            products(first: 250, after: $cursor, query: $query) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                  title
                  status
                  variants(first: 100) {
                    edges {
                      node {
                        id
                        sku
                        title
                        inventoryQuantity
                        metafields(first: 10) {
                          edges {
                            node {
                              id
                              namespace
                              key
                              value
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const response = await admin.graphql(productsQuery, {
          variables: { cursor, query: queryFilter },
        });
        const data = await response.json();

        if (data.errors || !data.data?.products) {
          console.error("GraphQL errors:", data.errors);
          break;
        }

        data.data.products.edges.forEach((productEdge) => {
          const product = productEdge.node;
          product.variants.edges.forEach((variantEdge) => {
            const variant = variantEdge.node;
            allVariants.push({
              id: variant.id,
              sku: variant.sku,
              variantTitle: variant.title,
              productTitle: product.title,
              productStatus: product.status || "ACTIVE",
              inventoryQuantity: variant.inventoryQuantity || 0,
              metafields: variant.metafields.edges.map((m) => m.node),
            });
          });
        });

        hasNextPage = data.data.products.pageInfo.hasNextPage;
        cursor = data.data.products.pageInfo.endCursor;
        pageCount++;
      } catch (error) {
        console.error("Error fetching products page:", error);
        break;
      }
    }

    return { variants: allVariants, isComplete: true };
  }

  return { error: "Unknown intent" };
}

// Also support GET for initial load
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    // Fetch first page of products quickly for initial display
    const productsQuery = `
      {
        products(first: 50, query: "status:ACTIVE") {
          pageInfo {
            hasNextPage
          }
          edges {
            node {
              id
              title
              status
              variants(first: 100) {
                edges {
                  node {
                    id
                    sku
                    title
                    inventoryQuantity
                    metafields(first: 10) {
                      edges {
                        node {
                          id
                          namespace
                          key
                          value
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    // Fetch suppliers
    const suppliersQuery = `
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

    const [productsResponse, suppliersResponse] = await Promise.all([
      admin.graphql(productsQuery),
      admin.graphql(suppliersQuery),
    ]);

    const productsData = await productsResponse.json();
    const suppliersData = await suppliersResponse.json();

    if (productsData.errors) {
      console.error("Products GraphQL errors:", productsData.errors);
      return { variants: [], suppliers: [], hasMoreProducts: false };
    }

    if (!suppliersData.data || !suppliersData.data.metaobjects) {
      console.error("Suppliers response error:", suppliersData);
      return { variants: [], suppliers: [], hasMoreProducts: false };
    }

    // Transform data
    const variants = [];
    const productEdges = productsData.data?.products?.edges || [];
    productEdges.forEach((productEdge) => {
      const product = productEdge.node;
      product.variants.edges.forEach((variantEdge) => {
        const variant = variantEdge.node;
        variants.push({
          id: variant.id,
          sku: variant.sku,
          variantTitle: variant.title,
          productTitle: product.title,
          productStatus: product.status || "ACTIVE",
          inventoryQuantity: variant.inventoryQuantity || 0,
          metafields: variant.metafields.edges.map((m) => m.node),
        });
      });
    });

    const suppliers = suppliersData.data.metaobjects.edges.map((e) => e.node);
    const hasMoreProducts = productsData.data?.products?.pageInfo?.hasNextPage || false;

    return { variants, suppliers, hasMoreProducts };
  } catch (error) {
    console.error("Products loader error:", error);
    return { variants: [], suppliers: [], hasMoreProducts: false };
  }
}
