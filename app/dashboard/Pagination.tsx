"use client";

import { PAGE_SIZE_OPTIONS } from "./pageSize";

export function Pagination({
  page,
  totalPages,
  pageSize,
  totalCount,
  baseQuery = "",
  pageParam = "page",
  pageSizeParam = "pageSize",
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  totalCount: number;
  // Every OTHER query param to preserve (filters, selected batch, …) as an
  // already-built query string (no leading "?", no page/pageSize entries).
  // A plain string crosses the Server→Client Component boundary fine —
  // unlike the buildHref callback this used to take, which broke once this
  // component needed "use client" for the pageSize <select>'s onChange
  // (functions can't be passed from a Server Component into a Client one).
  baseQuery?: string;
  pageParam?: string;
  pageSizeParam?: string;
}) {
  if (totalPages <= 1 && totalCount <= PAGE_SIZE_OPTIONS[0]) return null;

  function hrefFor(p: number, size: number) {
    const params = new URLSearchParams(baseQuery);
    params.set(pageSizeParam, String(size));
    params.set(pageParam, String(p));
    return `?${params.toString()}`;
  }

  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div className="pagination">
      {page > 1 ? <a href={hrefFor(page - 1, pageSize)}>« Trước</a> : <span className="disabled">« Trước</span>}
      <span className="pagination-status">
        {from}–{to} / {totalCount} đơn · Trang {page} / {totalPages}
      </span>
      {page < totalPages ? <a href={hrefFor(page + 1, pageSize)}>Sau »</a> : <span className="disabled">Sau »</span>}
      <select
        className="select"
        value={pageSize}
        onChange={(e) => {
          window.location.href = hrefFor(1, Number(e.target.value));
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
