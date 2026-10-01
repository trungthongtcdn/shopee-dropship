import { prisma } from "@/lib/db";
import { CancellationType } from "@prisma/client";

export interface CancellationFilters {
  // Empty = no filter (show every type).
  types: string[];
  q: string;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseCancellationFilters(raw: RawSearchParams): CancellationFilters {
  const value = raw.type;
  const types = value === undefined ? [] : (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
  const qValue = raw.q;
  const q = (Array.isArray(qValue) ? qValue[0] : qValue)?.trim() ?? "";
  return { types, q };
}

// "cancelled" (4.1 Đơn hủy) is deliberately never shown on this page — Luân
// doesn't care about those, per explicit feedback. Excluded unconditionally,
// not just left off the filter's option list, so it can't come back via a
// hand-crafted ?type=cancelled query param either.
export function loadCancellationRows(filters: CancellationFilters) {
  const selectedTypes = filters.types.filter((type) => type !== "cancelled");
  return prisma.cancellation.findMany({
    where: {
      isActive: true,
      type: selectedTypes.length > 0 ? { in: selectedTypes as CancellationType[] } : { not: "cancelled" },
      // trackingCode (outbound) and returnTrackingCode both live on this
      // same row, unlike the Report page where the equivalent search has
      // to cross a join — search by mã đơn hàng / mã vận đơn chiều đi /
      // mã vận đơn hoàn huỷ in one plain OR.
      ...(filters.q
        ? {
            OR: [
              { shopeeOrderId: { contains: filters.q, mode: "insensitive" as const } },
              { trackingCode: { contains: filters.q, mode: "insensitive" as const } },
              { returnTrackingCode: { contains: filters.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { orderDate: "desc" },
  });
}
