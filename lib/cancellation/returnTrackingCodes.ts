import type { Prisma } from "@prisma/client";

// A returned_refunded row keeps every return tracking code of its order in
// returnTrackingCodes (see the schema), starting with the one shown in
// returnTrackingCode. Rows synced before that column existed have only the single
// code, so both are always looked at.

export function allReturnTrackingCodes(row: { returnTrackingCode: string | null; returnTrackingCodes: string[] }): string[] {
  return [...new Set([row.returnTrackingCode, ...row.returnTrackingCodes].filter((code): code is string => !!code))];
}

// For a search box: part of the primary code, or exactly one of the others (an array
// can only be matched whole). Codes are stored upper case, searches may not be.
export function returnCodeSearchClauses(q: string): Prisma.CancellationWhereInput[] {
  return [
    { returnTrackingCode: { contains: q, mode: "insensitive" } },
    { returnTrackingCodes: { hasSome: [...new Set([q, q.toUpperCase()])] } },
  ];
}

// For matching a scan / message: any of the given codes is one of the row's.
export function returnCodeMatchClauses(codes: string[]): Prisma.CancellationWhereInput[] {
  return [{ returnTrackingCode: { in: codes } }, { returnTrackingCodes: { hasSome: codes } }];
}
