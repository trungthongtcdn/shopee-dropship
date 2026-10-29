import { prisma } from "@/lib/db";

// A "5. Trả hàng/hoàn tiền" row whose "Trạng thái Trả hàng/Hoàn tiền" reads
// "Yêu cầu của Người mua đã hủy" is a return the buyer withdrew: nothing is
// coming back, so the warehouse has nothing to receive.
const BUYER_CANCELLED_RETURN = "yeu cau cua nguoi mua da huy";

// Compared without tone marks / case / spacing so "hủy" and "huỷ" (two
// different Unicode spellings of the same word) and stray whitespace in the
// sheet cell all count as the same status.
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isBuyerCancelledReturn(returnRefundStatus: string | null | undefined): boolean {
  return returnRefundStatus != null && normalize(returnRefundStatus) === BUYER_CANCELLED_RETURN;
}

// Sets "Trạng thái nhận huỷ" to "Không cần nhận" on every order whose return was
// withdrawn by the buyer. Only lines with no status yet are touched, so a receipt
// typed in the Zalo group / Nhận đơn huỷ page / RowEditor is never overwritten.
// Writes the Order column itself (not a display-only label) so the report page,
// its filters and export, and the overdue warning all agree. Idempotent; called
// after the orders and returned_refunded syncs so it works whichever side of the
// order arrives second. Returns the number of order lines updated.
export async function markBuyerCancelledReturnsNotNeeded(): Promise<number> {
  const returns = await prisma.cancellation.findMany({
    where: { type: "returned_refunded", isActive: true, returnRefundStatus: { not: null } },
    select: { shopeeOrderId: true, returnRefundStatus: true },
  });
  const orderIds = [...new Set(returns.filter((r) => isBuyerCancelledReturn(r.returnRefundStatus)).map((r) => r.shopeeOrderId))];
  if (orderIds.length === 0) return 0;

  const result = await prisma.order.updateMany({
    where: { shopeeOrderId: { in: orderIds }, isActive: true, cancelReceiptStatus: null },
    data: { cancelReceiptStatus: "not_needed" },
  });
  return result.count;
}
