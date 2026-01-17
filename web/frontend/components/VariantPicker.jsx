import { useState, useCallback } from "react";
import { Button } from "@shopify/polaris";
import { ResourcePicker } from "@shopify/app-bridge-react";

export default function VariantPicker({ onSelect }) {
  const [open, setOpen] = useState(false);

  const handleSelection = useCallback(
    ({ selection }) => {
      setOpen(false);

      if (!selection || selection.length === 0) return;

      const variant = selection[0];

      onSelect({
        variantId: variant.id,
        sku: variant.sku,
        productTitle: variant.product?.title,
      });
    },
    [onSelect]
  );

  return (
    <>
      <Button onClick={() => setOpen(true)}>Select Variant</Button>

      <ResourcePicker
        resourceType="ProductVariant"
        showVariants
        open={open}
        onSelection={handleSelection}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}