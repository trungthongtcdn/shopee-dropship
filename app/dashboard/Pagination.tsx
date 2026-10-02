"use client";

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

export function Pagination({
  page,
  totalPages,
  buildHref,
  pageSize,
  onPageSizeHref,
  totalCount,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
  pageSize: number;
  onPageSizeHref: (size: number) => string;
  totalCount: number;
}) {
  if (totalPages <= 1 && totalCount <= PAGE_SIZE_OPTIONS[0]) return null;

  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div className="pagination">
      {page > 1 ? <a href={buildHref(page - 1)}>« Trước</a> : <span className="disabled">« Trước</span>}
      <span className="pagination-status">
        {from}–{to} / {totalCount} đơn · Trang {page} / {totalPages}
      </span>
      {page < totalPages ? <a href={buildHref(page + 1)}>Sau »</a> : <span className="disabled">Sau »</span>}
      <select
        className="select"
        value={pageSize}
        onChange={(e) => {
          window.location.href = onPageSizeHref(Number(e.target.value));
        }}
      >
        {PAGE_SIZE_OPTIONS.map((size) => (
          <option key={size} value={size}>
            {size}/trang
          </option>
        ))}
      </select>
    </div>
  );
}
