import { prisma } from "@/lib/db";
import type { CancelReceiptStatus } from "@prisma/client";

// Wording of the "Trạng thái nhận" column on Đơn hoàn huỷ. A receipt typed in the
// Zalo group or on the Nhận đơn huỷ page lands on Order.cancelReceiptStatus as
// received_full, which reads "Đã nhận"; the other explicit values staff can pick
// keep the report page's wording so a partial / not-needed order isn't passed off
// as received.
const LABELS: Record<CancelReceiptStatus, string> = {
  received_full: "Đã nhận",
  received_partial: "Nhận thiếu",
  not_received: "Chưa nhận",
  not_needed: "Không cần nhận",
};

// Least complete first: when the lines of one order disagree, show the one that
// still needs attention.
const LEAST_COMPLETE_FIRST: CancelReceiptStatus[] = ["not_received", "received_partial", "received_full", "not_needed"];

// One order = one Order row per product line. Blank while any line has no status,
// the same "still unresolved" rule loadOverdueWarnings uses, so a row never reads
// "Đã nhận" while it still counts toward the overdue warning.
export function receiptLabelFor(lineStatuses: (CancelReceiptStatus | null)[]): string {
  if (lineStatuses.length === 0 || lineStatuses.some((status) => status === null)) return "";
  const worst = LEAST_COMPLETE_FIRST.find((status) => lineStatuses.includes(status));
  return worst ? LABELS[worst] : "";
}

// Only orders with a non-blank label appear in the map.
export async function loadReceiptLabels(shopeeOrderIds: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (shopeeOrderIds.length === 0) return labels;

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
    const label = receiptLabelFor(statuses);
    if (label) labels.set(shopeeOrderId, label);
  }
  return labels;
}
