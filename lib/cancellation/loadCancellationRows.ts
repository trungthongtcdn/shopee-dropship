import { prisma } from "@/lib/db";
import { CancellationType } from "@prisma/client";

export interface CancellationFilters {
  // Empty = no filter (show every type).
  types: string[];
}

type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseCancellationFilters(raw: RawSearchParams): CancellationFilters {
  const value = raw.type;
  if (value === undefined) return { types: [] };
  const values = Array.isArray(value) ? value : [value];
  return { types: values.map((v) => v.trim()).filter(Boolean) };
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
    },
    orderBy: { orderDate: "desc" },
  });
}
