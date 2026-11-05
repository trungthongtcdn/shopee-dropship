import { prisma } from "@/lib/db";

// The complaint note ("TT khiếu nại huỷ") of each order: the Order rows are one per product
// line and the note is written to all of them, so the first filled one stands for the order.
// Only orders that have a note appear in the map.
export async function loadComplaintNotes(shopeeOrderIds: string[]): Promise<Map<string, string>> {
  const notes = new Map<string, string>();
  if (shopeeOrderIds.length === 0) return notes;

  const lines = await prisma.order.findMany({
    where: { shopeeOrderId: { in: [...new Set(shopeeOrderIds)] }, isActive: true, cancelComplaintNote: { not: null } },
    select: { shopeeOrderId: true, cancelComplaintNote: true },
    orderBy: { id: "asc" },
  });
  for (const line of lines) {
    if (line.cancelComplaintNote && !notes.has(line.shopeeOrderId)) notes.set(line.shopeeOrderId, line.cancelComplaintNote);
  }
  return notes;
}
