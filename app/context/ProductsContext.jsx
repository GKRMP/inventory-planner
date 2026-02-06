import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";

const ProductsContext = createContext(null);

export function ProductsProvider({ children, initialVariants = [], initialSuppliers = [], hasMoreProducts = false }) {
  const fetcher = useFetcher();
  const [variants, setVariants] = useState(initialVariants);
  const [suppliers] = useState(initialSuppliers);
  const [isComplete, setIsComplete] = useState(!hasMoreProducts);
  const hasStartedAutoLoad = useRef(false);

  // Update variants when fetcher completes
  useEffect(() => {
    if (fetcher.data?.variants && fetcher.state === "idle") {
      setVariants(fetcher.data.variants);
      setIsComplete(fetcher.data.isComplete || false);
    }
  }, [fetcher.data, fetcher.state]);

  // Auto-load all products in background when app starts
  useEffect(() => {
    if (hasMoreProducts && !hasStartedAutoLoad.current && fetcher.state === "idle") {
      hasStartedAutoLoad.current = true;
      // Small delay to let the page render first
      const timer = setTimeout(() => {
        fetcher.submit(
          { intent: "loadAllProducts", statusFilter: "ACTIVE" },
          { method: "post", action: "/api/products-loader" }
        );
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [hasMoreProducts, fetcher]);

  const isLoading = fetcher.state === "submitting" || fetcher.state === "loading";

  const loadAllProducts = useCallback((statusFilter = "ACTIVE") => {
    if (isComplete || isLoading) return;
    fetcher.submit(
      { intent: "loadAllProducts", statusFilter },
      { method: "post", action: "/api/products-loader" }
    );
  }, [fetcher, isComplete, isLoading]);

  const refreshProducts = useCallback((statusFilter = "ACTIVE") => {
    setIsComplete(false);
    hasStartedAutoLoad.current = false;
    fetcher.submit(
      { intent: "loadAllProducts", statusFilter },
      { method: "post", action: "/api/products-loader" }
    );
  }, [fetcher]);

  return (
    <ProductsContext.Provider
      value={{
        variants,
        suppliers,
        isComplete,
        isLoading,
        loadAllProducts,
        refreshProducts,
        hasMoreProducts: !isComplete,
      }}
    >
      {children}
    </ProductsContext.Provider>
  );
}

export function useProducts() {
  const context = useContext(ProductsContext);
  if (!context) {
    throw new Error("useProducts must be used within a ProductsProvider");
  }
  return context;
}
