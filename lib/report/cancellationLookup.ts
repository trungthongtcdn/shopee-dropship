import { prisma } from "@/lib/db";

export interface CancellationSummary {
  types: string[];
  // Only ever set from the returned_refunded row — the other two
  // cancellation types don't have a return shipment.
  returnTrackingCode: string | null;
}

// Shared by the Orders and Report pages, both of which need to know — per
// currently-displayed order — every Cancellation type recorded against it
// (to derive "Kết quả giao thực tế", see deliveryResult.ts) and the return
// tracking code if any. An order can have at most one Cancellation row per
// type (unique on shopeeOrderId+type), but in principle rows on more than
// one type at once.
export async function loadCancellationSummaries(shopeeOrderIds: string[]): Promise<Map<string, CancellationSummary>> {
  if (shopeeOrderIds.length === 0) return new Map();

  const rows = await prisma.cancellation.findMany({
    where: { shopeeOrderId: { in: shopeeOrderIds }, isActive: true },
    select: { shopeeOrderId: true, type: true, returnTrackingCode: true },
  });

  const map = new Map<string, CancellationSummary>();
  for (const row of rows) {
    const existing = map.get(row.shopeeOrderId) ?? { types: [], returnTrackingCode: null };
    existing.types.push(row.type);
    if (row.type === "returned_refunded" && row.returnTrackingCode) {
      existing.returnTrackingCode = row.returnTrackingCode;
    }
    map.set(row.shopeeOrderId, existing);
  }
  return map;
}
