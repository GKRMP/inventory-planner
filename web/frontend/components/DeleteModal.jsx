import { Modal, Text } from "@shopify/polaris";

export default function DeleteModal({
  open,
  title = "Delete",
  message = "Are you sure you want to delete this item?",
  onClose,
  onConfirm,
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      primaryAction={{
        content: "Delete",
        destructive: true,
        onAction: onConfirm,
        loading,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <Text as="p">{message}</Text>
      </Modal.Section>
    </Modal>
  );
}