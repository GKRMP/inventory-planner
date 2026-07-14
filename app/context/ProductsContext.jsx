import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";

const ProductsContext = createContext(null);

export function ProductsProvider({
  children,
  initialVariants = [],
  initialSuppliers = [],
  hasMoreProducts = false,
  initialCursor = null,
  initialLoadError = null,
}) {
  const pageFetcher = useFetcher();
  const suppliersFetcher = useFetcher();
  const [variants, setVariants] = useState(initialVariants);
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [isComplete, setIsComplete] = useState(!hasMoreProducts);
  const [loadError, setLoadError] = useState(initialLoadError);

  const cursorRef = useRef(initialCursor);
  const statusRef = useRef("ACTIVE");
  const hasStartedAutoLoad = useRef(false);
  const isFetchingPageRef = useRef(false);

  const isLoading = pageFetcher.state === "submitting" || pageFetcher.state === "loading";

  const requestNextPage = useCallback(
    (statusFilter) => {
      if (isFetchingPageRef.current) return;
      isFetchingPageRef.current = true;
      pageFetcher.submit(
        {
          intent: "loadPage",
          statusFilter: statusFilter || statusRef.current,
          cursor: cursorRef.current || "",
        },
        { method: "post", action: "/api/products-loader" }
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Handle each page response: append on success, surface errors without
  // ever marking a failed/partial load as complete.
  useEffect(() => {
    if (pageFetcher.state !== "idle" || !pageFetcher.data) return;
    isFetchingPageRef.current = false;

    const data = pageFetcher.data;

    if (data.error) {
      setLoadError(data.error);
      return;
    }

    setLoadError(null);
    setVariants((prev) => {
      const seen = new Set(prev.map((v) => v.id));
      const merged = prev.slice();
      (data.variants || []).forEach((v) => {
        if (!seen.has(v.id)) merged.push(v);
      });
      return merged;
    });

    const hasNextPage = !!data.pageInfo?.hasNextPage;
    cursorRef.current = data.pageInfo?.endCursor || null;

    if (hasNextPage) {
      requestNextPage(statusRef.current);
    } else {
      setIsComplete(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageFetcher.state, pageFetcher.data]);

  useEffect(() => {
    if (suppliersFetcher.data?.suppliers && suppliersFetcher.state === "idle") {
      setSuppliers(suppliersFetcher.data.suppliers);
    }
  }, [suppliersFetcher.data, suppliersFetcher.state]);

  // Auto-continue loading remaining pages once the first (server-rendered)
  // page has already been shown.
  useEffect(() => {
    if (hasMoreProducts && !isComplete && !hasStartedAutoLoad.current) {
      hasStartedAutoLoad.current = true;
      const timer = setTimeout(() => requestNextPage(statusRef.current), 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMoreProducts]);

  const retryLoad = useCallback(() => {
    setLoadError(null);
    requestNextPage(statusRef.current);
  }, [requestNextPage]);

  const refreshProducts = useCallback(
    (statusFilter = "ACTIVE") => {
      statusRef.current = statusFilter;
      cursorRef.current = null;
      hasStartedAutoLoad.current = true;
      setVariants([]);
      setIsComplete(false);
      setLoadError(null);
      requestNextPage(statusFilter);
    },
    [requestNextPage]
  );

  const refreshSuppliers = useCallback(() => {
    suppliersFetcher.load("/api/suppliers");
  }, [suppliersFetcher]);

  return (
    <ProductsContext.Provider
      value={{
        variants,
        suppliers,
        isComplete,
        isLoading,
        loadError,
        retryLoad,
        loadedCount: variants.length,
        loadAllProducts: refreshProducts,
        refreshProducts,
        refreshSuppliers,
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
