export const DELIVERY_RESULT_VALUES = ["delivered", "cancelled", "delivery_failed", "returned_refunded"] as const;
export type DeliveryResult = (typeof DELIVERY_RESULT_VALUES)[number];

export const DELIVERY_RESULT_LABELS: Record<DeliveryResult, string> = {
  delivered: "Đã giao",
  cancelled: "Đã huỷ",
  delivery_failed: "Giao thất bại",
  returned_refunded: "Trả hàng hoàn tiền",
};

// Order.status is always "HOÀN THÀNH" straight from the Shopee sheet
// regardless of what actually happened to the order — the real outcome only
// shows up as a row on one of the three Cancellation tabs (4.1 Đơn hủy /
// 4.2 Giao thất bại / 5. Trả hàng/hoàn tiền). An order can in principle have
// rows on more than one tab (e.g. it failed delivery, then was also later
// logged as returned/refunded) — returned_refunded wins because it's the
// most complex workflow and typically the most recent/final outcome of the
// three; delivery_failed beats cancelled for the same "later in the
// lifecycle" reasoning. No matching Cancellation row at all means the order
// actually delivered as shown.
export function deriveDeliveryResult(cancellationTypes: string[]): DeliveryResult {
  if (cancellationTypes.includes("returned_refunded")) return "returned_refunded";
  if (cancellationTypes.includes("delivery_failed")) return "delivery_failed";
  if (cancellationTypes.includes("cancelled")) return "cancelled";
  return "delivered";
}
