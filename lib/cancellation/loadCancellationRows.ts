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

export function loadCancellationRows(filters: CancellationFilters) {
  return prisma.cancellation.findMany({
    where: {
      isActive: true,
      ...(filters.types.length > 0 ? { type: { in: filters.types as CancellationType[] } } : {}),
    },
    orderBy: { orderDate: "desc" },
  });
}
