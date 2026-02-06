import { InlineStack, Text, Spinner } from "@shopify/polaris";
import { useProducts } from "../context/ProductsContext";

export default function ProductsLoadingIndicator() {
  const { isLoading, isComplete, variants } = useProducts();

  if (isComplete) {
    return null;
  }

  if (isLoading) {
    return (
      <InlineStack gap="200" align="center" blockAlign="center">
        <Spinner size="small" />
        <Text variant="bodySm" tone="subdued">
          Loading all products...
        </Text>
      </InlineStack>
    );
  }

  // Partial data, but not loading (shouldn't happen with auto-load, but just in case)
  return (
    <Text variant="bodySm" tone="subdued">
      Showing {variants.length} products (partial data)
    </Text>
  );
}
