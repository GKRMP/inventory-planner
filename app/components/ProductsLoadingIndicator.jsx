import { InlineStack, Text, Spinner, Button } from "@shopify/polaris";
import { useProducts } from "../context/ProductsContext";

export default function ProductsLoadingIndicator() {
  const { isLoading, isComplete, loadError, retryLoad, loadedCount } = useProducts();

  if (loadError) {
    return (
      <InlineStack gap="200" align="center" blockAlign="center">
        <Text variant="bodySm" tone="critical">
          Couldn&apos;t load more products ({loadedCount.toLocaleString()} loaded so far): {loadError}
        </Text>
        <Button size="slim" onClick={retryLoad}>
          Retry
        </Button>
      </InlineStack>
    );
  }

  if (isComplete) {
    return null;
  }

  if (isLoading) {
    return (
      <InlineStack gap="200" align="center" blockAlign="center">
        <Spinner size="small" />
        <Text variant="bodySm" tone="subdued">
          Loading products… {loadedCount.toLocaleString()} loaded so far
        </Text>
      </InlineStack>
    );
  }

  // Partial data, but not loading (shouldn't happen with auto-load, but just in case)
  return (
    <Text variant="bodySm" tone="subdued">
      Showing {loadedCount.toLocaleString()} variants (partial data)
    </Text>
  );
}
