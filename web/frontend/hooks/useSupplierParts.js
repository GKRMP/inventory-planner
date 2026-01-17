import { useEffect, useState, useCallback } from "react";

export function useSupplierParts() {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/supplier-parts");
      if (!res.ok) throw new Error("Failed to load supplier-part links");
      const data = await res.json();
      setParts(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { parts, loading, error, refresh };
}