import { prisma } from "@/lib/db";
import type { CancelReceiptStatus } from "@prisma/client";

// Wording of the "Trạng thái nhận" column on Đơn hoàn huỷ. A receipt typed in the
// Zalo group or on the Nhận đơn huỷ page lands on Order.cancelReceiptStatus as
// received_full, which reads "Đã nhận"; the other explicit values staff can pick
// keep the report page's wording so a partial / not-needed order isn't passed off
// as received.
export const RECEIPT_LABELS: Record<CancelReceiptStatus, string> = {
  received_full: "Đã nhận",
  received_partial: "Nhận thiếu",
  not_received: "Chưa nhận",
  not_needed: "Không cần nhận",
};

// Least complete first: when the lines of one order disagree, show the one that
// still needs attention.
const LEAST_COMPLETE_FIRST: CancelReceiptStatus[] = ["not_received", "received_partial", "received_full", "not_needed"];

// One order = one Order row per product line. Null (blank) while any line has no
// status, the same "still unresolved" rule loadOverdueWarnings uses, so a row never
// reads "Đã nhận" while it still counts toward the overdue warning.
export function receiptStatusFor(lineStatuses: (CancelReceiptStatus | null)[]): CancelReceiptStatus | null {
  if (lineStatuses.length === 0 || lineStatuses.some((status) => status === null)) return null;
  return LEAST_COMPLETE_FIRST.find((status) => lineStatuses.includes(status)) ?? null;
}

export function receiptLabelFor(lineStatuses: (CancelReceiptStatus | null)[]): string {
  const status = receiptStatusFor(lineStatuses);
  return status ? RECEIPT_LABELS[status] : "";
}

// Only orders with a resolved status appear in the map.
export async function loadReceiptStatuses(shopeeOrderIds: string[]): Promise<Map<string, CancelReceiptStatus>> {
  const result = new Map<string, CancelReceiptStatus>();
  if (shopeeOrderIds.length === 0) return result;

  const lines = await prisma.order.findMany({
    where: { shopeeOrderId: { in: [...new Set(shopeeOrderIds)] }, isActive: true },
    select: { shopeeOrderId: true, cancelReceiptStatus: true },
  });
  const statusesByOrder = new Map<string, (CancelReceiptStatus | null)[]>();
  for (const line of lines) {
    const statuses = statusesByOrder.get(line.shopeeOrderId) ?? [];
    statuses.push(line.cancelReceiptStatus);
    statusesByOrder.set(line.shopeeOrderId, statuses);
  }
  for (const [shopeeOrderId, statuses] of statusesByOrder) {
    const status = receiptStatusFor(statuses);
    if (status) result.set(shopeeOrderId, status);
  }
  return result;
}

// Only orders with a non-blank label appear in the map.
export async function loadReceiptLabels(shopeeOrderIds: string[]): Promise<Map<string, string>> {
  const statuses = await loadReceiptStatuses(shopeeOrderIds);
  return new Map([...statuses].map(([shopeeOrderId, status]) => [shopeeOrderId, RECEIPT_LABELS[status]]));
}
