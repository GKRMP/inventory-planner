import { useState } from "react";

export function useDeleteResource() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  async function deleteResource(url) {
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.message || "Delete failed");
      }

      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setDeleting(false);
    }
  }

  return { deleteResource, deleting, error };
}