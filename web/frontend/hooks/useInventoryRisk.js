import { useEffect, useState, useCallback } from "react";

export function useInventoryRisk() {
  const [risk, setRisk] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inventory-risk");
      if (!res.ok) throw new Error("Failed to load inventory risk data");
      const data = await res.json();
      setRisk(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { risk, loading, error, refresh };
}