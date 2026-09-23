const PAGE_SIZE = 100;

export function parsePage(raw: string | undefined): number {
  const page = Number.parseInt(raw ?? "1", 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function totalPagesFor(totalCount: number): number {
  return Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
}

export { PAGE_SIZE };

export function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="pagination">
      {page > 1 ? <a href={buildHref(page - 1)}>« Trước</a> : <span className="disabled">« Trước</span>}
      <span className="pagination-status">
        Trang {page} / {totalPages}
      </span>
      {page < totalPages ? <a href={buildHref(page + 1)}>Sau »</a> : <span className="disabled">Sau »</span>}
    </div>
  );
}
