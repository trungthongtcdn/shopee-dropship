import { prisma } from "@/lib/db";
import type { CancellationType } from "@prisma/client";

// Both thresholds requested by Luân: a "Trả hàng hoàn tiền" (THHT) row is
// overdue 5 days after the buyer's complaint; a "Giao thất bại" (4.2) row is
// overdue 1 day after Shopee marks the cancellation done — in both cases
// only while the order still has no "Trạng thái nhận huỷ" AND no "TT khiếu
// nại huỷ" filled in (i.e. nobody has started handling it yet).
const THRESHOLD_HOURS: Record<"returned_refunded" | "delivery_failed", number> = {
  returned_refunded: 5 * 24,
  delivery_failed: 1 * 24,
};

export interface OverdueWarningRow {
  cancellationId: number;
  shopeeOrderId: string;
  type: "returned_refunded" | "delivery_failed";
  triggerAt: Date;
  daysOverdue: number;
  alreadyWarned: boolean;
}

// Shared by the AppHeader banner (every currently-overdue row, regardless of
// alreadyWarned) and the Zalo poller (which only acts on rows where
// alreadyWarned is false) — one query, two different filters on top of it,
// so the two surfaces can never disagree about what counts as overdue.
export async function loadOverdueWarnings(): Promise<OverdueWarningRow[]> {
  const types: CancellationType[] = ["returned_refunded", "delivery_failed"];
  const rows = await prisma.cancellation.findMany({
    where: { isActive: true, type: { in: types } },
    select: {
      id: true,
      shopeeOrderId: true,
      type: true,
      complaintAt: true,
      cancelledAt: true,
      overdueWarnedAt: true,
    },
  });
  if (rows.length === 0) return [];

  const orderIds = [...new Set(rows.map((r) => r.shopeeOrderId))];
  const orders = await prisma.order.findMany({
    where: { shopeeOrderId: { in: orderIds }, isActive: true },
    select: { shopeeOrderId: true, cancelReceiptStatus: true, cancelComplaintNote: true },
  });
  // Order is keyed by (shopeeOrderId, categoryName) — a multi-product order
  // has one row per product line. Unresolved means AT LEAST ONE line still
  // has both fields empty (err toward still warning rather than going quiet
  // just because one line of several got filled in).
  const unresolvedOrderIds = new Set(
    orders
      .filter((o) => o.cancelReceiptStatus === null && (o.cancelComplaintNote ?? "").trim() === "")
      .map((o) => o.shopeeOrderId)
  );

  const now = Date.now();
  const warnings: OverdueWarningRow[] = [];
  for (const row of rows) {
    if (row.type !== "returned_refunded" && row.type !== "delivery_failed") continue;
    if (!unresolvedOrderIds.has(row.shopeeOrderId)) continue;

    const triggerAt = row.type === "returned_refunded" ? row.complaintAt : row.cancelledAt;
    if (!triggerAt) continue;

    const hoursElapsed = (now - triggerAt.getTime()) / (1000 * 60 * 60);
    if (hoursElapsed < THRESHOLD_HOURS[row.type]) continue;

    warnings.push({
      cancellationId: row.id,
      shopeeOrderId: row.shopeeOrderId,
      type: row.type,
      triggerAt,
      daysOverdue: Math.floor(hoursElapsed / 24),
      alreadyWarned: row.overdueWarnedAt !== null,
    });
  }

  return warnings;
}
