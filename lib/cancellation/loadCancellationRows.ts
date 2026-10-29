import { prisma } from "@/lib/db";
import { CancellationType } from "@prisma/client";

export interface CancellationFilters {
  // Empty = no filter (show every type).
  types: string[];
  q: string;
  // Shops that want their "cancelled" rows on the page too — see showsCancelledOrders.
  includeCancelled?: boolean;
}

// Shop 2 has no separate "giao thất bại" sheet: what it sends is sheet 5.1
// (cancelled) and sheet 5 (returned/refunded), and it wants to see both here.
// The first shop still hides "cancelled" (see loadCancellationRows).
const SHOPS_SHOWING_CANCELLED = new Set(["shop_2"]);

export function showsCancelledOrders(shopSlug: string): boolean {
  return SHOPS_SHOWING_CANCELLED.has(shopSlug);
}

type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseCancellationFilters(raw: RawSearchParams): CancellationFilters {
  const value = raw.type;
  const types = value === undefined ? [] : (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
  const qValue = raw.q;
  const q = (Array.isArray(qValue) ? qValue[0] : qValue)?.trim() ?? "";
  return { types, q };
}

// "cancelled" (4.1 Đơn hủy) is deliberately never shown on this page for the
// first shop — Luân doesn't care about those, per explicit feedback. Excluded
// unconditionally, not just left off the filter's option list, so it can't come
// back via a hand-crafted ?type=cancelled query param either. Only a shop that
// opts in with includeCancelled (shop 2) sees them.
export function loadCancellationRows(filters: CancellationFilters) {
  const selectedTypes = filters.includeCancelled ? filters.types : filters.types.filter((type) => type !== "cancelled");
  const noTypeFilter: { not: CancellationType } | undefined = filters.includeCancelled ? undefined : { not: "cancelled" };
  return prisma.cancellation.findMany({
    where: {
      isActive: true,
      type: selectedTypes.length > 0 ? { in: selectedTypes as CancellationType[] } : noTypeFilter,
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
