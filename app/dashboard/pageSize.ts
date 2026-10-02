// Plain functions/constants only — deliberately NOT "use client". Server
// Component pages (page.tsx) call these directly during render; a Server
// Component importing a value export from a "use client" file gets back an
// opaque client reference instead of the real function (works fine in
// Vitest/tsc, breaks at runtime with "is not a function") — see Pagination.tsx.
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export function parsePageSize(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export function parsePage(raw: string | undefined): number {
  const page = Number.parseInt(raw ?? "1", 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function totalPagesFor(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}
