import { MatchStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { UploadForm } from "./UploadForm";
import { PAGE_SIZE, Pagination, parsePage, totalPagesFor } from "../Pagination";

export const dynamic = "force-dynamic";

// Derived from the Prisma enum so the UI cannot drift out of sync with the
// database's match_status values.
const VALID_MATCH_STATUSES = Object.values(MatchStatus);

function isValidMatchStatus(value: string | undefined): value is MatchStatus {
  return VALID_MATCH_STATUSES.includes(value as MatchStatus);
}

function formatAmount(value: number | null) {
  return value === null ? "-" : value.toLocaleString("vi-VN");
}

function matchStatusBadgeClass(status: MatchStatus) {
  if (status === "matched") return "badge badge-success";
  if (status === "status_mismatch") return "badge badge-danger";
  return "badge badge-warning";
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: { status?: string; batchId?: string; page?: string; paymentBatchId?: string; pbPage?: string };
}) {
  const page = parsePage(searchParams.page);
  const batches = await prisma.reconciliationBatch.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 20,
  });

  const requestedBatchId = Number(searchParams.batchId);
  const selectedBatch =
    (Number.isInteger(requestedBatchId) ? batches.find((batch) => batch.id === requestedBatchId) : undefined) ??
    batches[0];

  const statusFilter = isValidMatchStatus(searchParams.status) ? searchParams.status : undefined;

  // Fetch the whole batch once: the table needs the filtered subset, while the
  // summary counts and the discrepancy total must describe the entire batch
  // regardless of the active filter. The total is a sum of absolute
  // differences, which Prisma cannot aggregate without raw SQL anyway.
  const batchResults = selectedBatch
    ? await prisma.reconciliationResult.findMany({
        where: { batchId: selectedBatch.id },
        orderBy: { id: "asc" },
      })
    : [];

  const countsByStatus = VALID_MATCH_STATUSES.map((status) => ({
    status,
    count: batchResults.filter((result) => result.matchStatus === status).length,
  })).filter((entry) => entry.count > 0);

  // Rows with a missing side (missing_in_sheet / missing_in_excel / parse_error)
  // have no comparable pair, so they are skipped rather than treated as zero.
  const discrepancyTotal = batchResults.reduce((total, result) => {
    if (result.sheetAmount === null || result.excelAmount === null) return total;
    return total + Math.abs(result.sheetAmount - result.excelAmount);
  }, 0);

  const filteredResults = statusFilter
    ? batchResults.filter((result) => result.matchStatus === statusFilter)
    : batchResults;
  const totalPages = totalPagesFor(filteredResults.length);
  const results = filteredResults.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const buildPageHref = (p: number) => {
    const params = new URLSearchParams();
    if (selectedBatch) params.set("batchId", String(selectedBatch.id));
    if (statusFilter) params.set("status", statusFilter);
    params.set("page", String(p));
    return `?${params.toString()}`;
  };

  // Weekly payment batches synced from Drive — independent of the manual
  // upload batches above (see PaymentSync.gs's syncPaymentBatches).
  const pbPage = parsePage(searchParams.pbPage);
  const paymentBatches = await prisma.paymentBatch.findMany({ orderBy: { syncedAt: "desc" } });

  const requestedPaymentBatchId = Number(searchParams.paymentBatchId);
  const selectedPaymentBatch = Number.isInteger(requestedPaymentBatchId)
    ? paymentBatches.find((batch) => batch.id === requestedPaymentBatchId)
    : undefined;

  const paymentBatchLineTotal = selectedPaymentBatch
    ? await prisma.paymentBatchLine.count({ where: { batchId: selectedPaymentBatch.id } })
    : 0;
  const paymentBatchTotalPages = totalPagesFor(paymentBatchLineTotal);
  const paymentBatchLines = selectedPaymentBatch
    ? await prisma.paymentBatchLine.findMany({
        where: { batchId: selectedPaymentBatch.id },
        orderBy: { sheetRowIndex: "asc" },
        skip: (pbPage - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      })
    : [];

  const buildPaymentBatchPageHref = (p: number) => {
    const params = new URLSearchParams();
    if (selectedPaymentBatch) params.set("paymentBatchId", String(selectedPaymentBatch.id));
    params.set("pbPage", String(p));
    return `?${params.toString()}`;
  };

  return (
    <main className="page">
      <h1>Reconciliation</h1>

      <div className="card">
        <UploadForm />
      </div>

      <h2>Batches (upload tay)</h2>
      {batches.length === 0 ? (
        <p className="empty-state">Chưa có batch nào được upload.</p>
      ) : (
        <ul className="list-plain">
          {batches.map((batch) => (
            <li key={batch.id}>
              <a className={`list-item-link${batch.id === selectedBatch?.id ? " active" : ""}`} href={`?batchId=${batch.id}`}>
                <span>{batch.fileName}</span>
                <span className="list-item-meta">
                  {batch.uploadedAt.toLocaleString("vi-VN")} · {batch.status}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {selectedBatch ? (
        <>
          <h3>
            Batch {selectedBatch.id}: {selectedBatch.fileName}
          </h3>

          <div className="toolbar">
            <a className={`filter-pill${!statusFilter ? " active" : ""}`} href={`?batchId=${selectedBatch.id}`}>
              Tất cả
            </a>
            {VALID_MATCH_STATUSES.map((status) => (
              <a
                key={status}
                className={`filter-pill${statusFilter === status ? " active" : ""}`}
                href={`?batchId=${selectedBatch.id}&status=${status}`}
              >
                {status}
              </a>
            ))}
          </div>

          <div className="summary-bar">
            <span className="stat-chip">
              <strong>{batchResults.length}</strong> kết quả
            </span>
            {countsByStatus.map((entry) => (
              <span className="stat-chip" key={entry.status}>
                {entry.status}: <strong>{entry.count}</strong>
              </span>
            ))}
            <span className="stat-chip">
              Tổng chênh lệch: <strong>{discrepancyTotal.toLocaleString("vi-VN")}</strong>
            </span>
          </div>

          <Pagination page={page} totalPages={totalPages} buildHref={buildPageHref} />

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã đơn hàng</th>
                  <th>Trạng thái</th>
                  <th>Sheet amount</th>
                  <th>Excel amount</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.id}>
                    <td>{result.shopeeOrderId ?? "-"}</td>
                    <td>
                      <span className={matchStatusBadgeClass(result.matchStatus)}>{result.matchStatus}</span>
                    </td>
                    <td className="num">{formatAmount(result.sheetAmount)}</td>
                    <td className="num">{formatAmount(result.excelAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {results.length === 0 ? <p className="empty-state">Không có kết quả cho bộ lọc này.</p> : null}
          </div>
          <Pagination page={page} totalPages={totalPages} buildHref={buildPageHref} />
        </>
      ) : null}

      <h2>Đối soát thanh toán (tự động từ Drive)</h2>
      <p className="page-description">Mỗi tuần trên file thanh toán Shopee là 1 batch dưới đây, tên trùng với tên sheet.</p>
      {paymentBatches.length === 0 ? (
        <p className="empty-state">Chưa có batch nào được đồng bộ.</p>
      ) : (
        <ul className="list-plain">
          {paymentBatches.map((batch) => (
            <li key={batch.id}>
              <a
                className={`list-item-link${batch.id === selectedPaymentBatch?.id ? " active" : ""}`}
                href={`?paymentBatchId=${batch.id}`}
              >
                <span>{batch.weekLabel}</span>
                <span className="list-item-meta">đồng bộ lúc {batch.syncedAt.toLocaleString("vi-VN")}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {selectedPaymentBatch ? (
        <>
          <h3>Batch: {selectedPaymentBatch.weekLabel}</h3>
          <div className="summary-bar">
            <span className="stat-chip">
              <strong>{paymentBatchLineTotal}</strong> dòng
            </span>
          </div>

          <Pagination page={pbPage} totalPages={paymentBatchTotalPages} buildHref={buildPaymentBatchPageHref} />

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã đơn hàng</th>
                  <th>Mã sản phẩm</th>
                  <th>Tên hàng hóa</th>
                  <th>SL</th>
                  <th>Giá bán</th>
                  <th>Phí dịch vụ</th>
                  <th>Khấu trừ thuế</th>
                  <th>Giá trị còn lại</th>
                </tr>
              </thead>
              <tbody>
                {paymentBatchLines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.shopeeOrderId}</td>
                    <td>{line.sku ?? "-"}</td>
                    <td>{line.productName ?? "-"}</td>
                    <td className="num">{line.quantity ?? "-"}</td>
                    <td className="num">{formatAmount(line.sellPrice)}</td>
                    <td className="num">{formatAmount(line.serviceFee)}</td>
                    <td className="num">{formatAmount(line.taxDeduction)}</td>
                    <td className="num">{formatAmount(line.netAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={pbPage} totalPages={paymentBatchTotalPages} buildHref={buildPaymentBatchPageHref} />
        </>
      ) : null}
    </main>
  );
}
