import { Outlet, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider, Frame } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { ProductsProvider } from "../context/ProductsContext";

export const loader = async ({ request }) => {
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
      return {
        apiKey: process.env.SHOPIFY_API_KEY || "",
        variants: [],
        suppliers: [],
        hasMoreProducts: false
      };
    }

    if (!suppliersData.data || !suppliersData.data.metaobjects) {
      console.error("Suppliers response error:", suppliersData);
      return {
        apiKey: process.env.SHOPIFY_API_KEY || "",
        variants: [],
        suppliers: [],
        hasMoreProducts: false
      };
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

    return {
      apiKey: process.env.SHOPIFY_API_KEY || "",
      variants,
      suppliers,
      hasMoreProducts
    };
  } catch (error) {
    console.error("App loader error:", error);
    return {
      apiKey: process.env.SHOPIFY_API_KEY || "",
      variants: [],
      suppliers: [],
      hasMoreProducts: false
    };
  }
};

export default function App() {
  const { apiKey, variants, suppliers, hasMoreProducts } = useLoaderData();

  return (
    <ShopifyAppProvider apiKey={apiKey} embedded>
      <PolarisAppProvider i18n={enTranslations}>
        <ProductsProvider
          initialVariants={variants}
          initialSuppliers={suppliers}
          hasMoreProducts={hasMoreProducts}
        >
          <Frame>
            <Outlet />
          </Frame>
        </ProductsProvider>
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}
