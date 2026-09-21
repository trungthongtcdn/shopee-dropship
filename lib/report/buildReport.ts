export interface ReportOrderInput {
  id: number;
  shopeeOrderId: string;
  status: string;
  trackingCode: string | null;
  productName: string | null;
  categoryName: string | null;
  lineQuantity: number | null;
  sentAt: Date | null;
  sendStatus: string | null;
  paidAt: Date | null;
  defectRate: number | null;
  cancelReceiptStatus: string | null;
  cancelComplaintNote: string | null;
  note: string | null;
  luanCheck: boolean;
}

export interface ReportProductInput {
  categoryName: string | null;
  sku: string;
  kiotCode: string | null;
  collectPrice: number | null;
}

export interface ReportPaymentInput {
  shopeeOrderId: string;
  excelAmount: number | null;
}

export interface ReportCancellationInput {
  shopeeOrderId: string;
  cancelledAt: Date | null;
}

export type PaymentMatch = "matched" | "not_matched";

export interface ReportRow {
  orderId: number;
  shopeeOrderId: string;
  status: string;
  trackingCode: string | null;
  productName: string | null;
  categoryName: string | null;
  quantity: number | null;
  sku: string | null;
  kiotCode: string | null;
  amountDue: number | null;
  amountPaid: number | null;
  diffPercent: number | null;
  paymentMatch: PaymentMatch | null;
  cancelReceivedAt: Date | null;
  sentAt: Date | null;
  sendStatus: string | null;
  paidAt: Date | null;
  defectRate: number | null;
  cancelReceiptStatus: string | null;
  cancelComplaintNote: string | null;
  note: string | null;
  luanCheck: boolean;
}

// Confirmed business rule: >2% difference in EITHER direction is a mismatch.
const PAYMENT_MATCH_TOLERANCE = 0.02;

function normalizeCategoryName(value: string) {
  return value.trim().toLowerCase();
}

export function buildReportRows(
  orders: ReportOrderInput[],
  products: ReportProductInput[],
  payments: ReportPaymentInput[],
  cancellations: ReportCancellationInput[]
): ReportRow[] {
  const productByCategory = new Map(
    products.filter((product) => product.categoryName).map((product) => [normalizeCategoryName(product.categoryName!), product])
  );
  const paymentByOrderId = new Map(payments.map((payment) => [payment.shopeeOrderId, payment.excelAmount]));
  const cancelledAtByOrderId = new Map(cancellations.map((cancellation) => [cancellation.shopeeOrderId, cancellation.cancelledAt]));

  return orders.map((order) => {
    const product = order.categoryName ? productByCategory.get(normalizeCategoryName(order.categoryName)) : undefined;
    const quantity = order.lineQuantity ?? 1;
    const amountDue = product?.collectPrice != null ? product.collectPrice * quantity : null;
    const amountPaid = paymentByOrderId.get(order.shopeeOrderId) ?? null;

    let diffPercent: number | null = null;
    let paymentMatch: PaymentMatch | null = null;
    if (amountDue !== null && amountDue !== 0 && amountPaid !== null) {
      diffPercent = (amountPaid - amountDue) / amountDue;
      paymentMatch = Math.abs(diffPercent) <= PAYMENT_MATCH_TOLERANCE ? "matched" : "not_matched";
    }

    return {
      orderId: order.id,
      shopeeOrderId: order.shopeeOrderId,
      status: order.status,
      trackingCode: order.trackingCode,
      productName: order.productName,
      categoryName: order.categoryName,
      quantity: order.lineQuantity,
      sku: product?.sku ?? null,
      kiotCode: product?.kiotCode ?? null,
      amountDue,
      amountPaid,
      diffPercent,
      paymentMatch,
      cancelReceivedAt: cancelledAtByOrderId.get(order.shopeeOrderId) ?? null,
      sentAt: order.sentAt,
      sendStatus: order.sendStatus,
      paidAt: order.paidAt,
      defectRate: order.defectRate,
      cancelReceiptStatus: order.cancelReceiptStatus,
      cancelComplaintNote: order.cancelComplaintNote,
      note: order.note,
      luanCheck: order.luanCheck,
    };
  });
}
