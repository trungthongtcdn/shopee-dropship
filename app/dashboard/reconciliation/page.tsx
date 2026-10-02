import { MatchStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { UploadForm } from "./UploadForm";
import { Pagination } from "../Pagination";
import { parsePage, parsePageSize, totalPagesFor } from "../pageSize";
import { formatDateTimeVN } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

// Derived from the Prisma enum so the UI cannot drift out of sync with the
// database's match_status values.
const VALID_MATCH_STATUSES = Object.values(MatchStatus);

const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  matched: "Khớp",
  status_mismatch: "Lệch trạng thái",
  missing_in_sheet: "Thiếu trên Sheet",
  missing_in_excel: "Thiếu trong Excel",
  parse_error: "Lỗi đọc dòng",
};

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
  searchParams: {
    view?: string;
    status?: string;
    batchId?: string;
    page?: string;
    pageSize?: string;
    paymentBatchId?: string;
    pbPage?: string;
    pbPageSize?: string;
  };
}) {
  const view = searchParams.view === "weekly" ? "weekly" : "upload";
  const page = parsePage(searchParams.page);
  const pageSize = parsePageSize(searchParams.pageSize);
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
  }));

  // Rows with a missing side (missing_in_sheet / missing_in_excel / parse_error)
  // have no comparable pair, so they are skipped rather than treated as zero.
  const discrepancyTotal = batchResults.reduce((total, result) => {
    if (result.sheetAmount === null || result.excelAmount === null) return total;
    return total + Math.abs(result.sheetAmount - result.excelAmount);
  }, 0);

  const filteredResults = statusFilter
    ? batchResults.filter((result) => result.matchStatus === statusFilter)
    : batchResults;
  const totalPages = totalPagesFor(filteredResults.length, pageSize);
  const results = filteredResults.slice((page - 1) * pageSize, page * pageSize);

  const batchQuery = new URLSearchParams();
  if (selectedBatch) batchQuery.set("batchId", String(selectedBatch.id));
  if (statusFilter) batchQuery.set("status", statusFilter);

  const statCardHref = (status: MatchStatus | undefined) => {
    const params = new URLSearchParams();
    if (selectedBatch) params.set("batchId", String(selectedBatch.id));
    if (status) params.set("status", status);
    return `?${params.toString()}`;
  };

  // Weekly payment batches synced from Drive — independent of the manual
  // upload batches above (see PaymentSync.gs's syncPaymentBatches).
  const pbPage = parsePage(searchParams.pbPage);
  const pbPageSize = parsePageSize(searchParams.pbPageSize);
  const paymentBatches = await prisma.paymentBatch.findMany({ orderBy: { syncedAt: "desc" } });

  const requestedPaymentBatchId = Number(searchParams.paymentBatchId);
  const selectedPaymentBatch = Number.isInteger(requestedPaymentBatchId)
    ? paymentBatches.find((batch) => batch.id === requestedPaymentBatchId)
    : undefined;

  const paymentBatchLineTotal = selectedPaymentBatch
    ? await prisma.paymentBatchLine.count({ where: { batchId: selectedPaymentBatch.id } })
    : 0;
  const paymentBatchTotalPages = totalPagesFor(paymentBatchLineTotal, pbPageSize);
  const [paymentBatchLines, paymentBatchSums] = selectedPaymentBatch
    ? await Promise.all([
        prisma.paymentBatchLine.findMany({
          where: { batchId: selectedPaymentBatch.id },
          orderBy: { sheetRowIndex: "asc" },
          skip: (pbPage - 1) * pbPageSize,
          take: pbPageSize,
        }),
        prisma.paymentBatchLine.aggregate({
          where: { batchId: selectedPaymentBatch.id },
          _sum: { sellPrice: true, serviceFee: true, taxDeduction: true, netAmount: true },
        }),
      ])
    : [[], null];

  const paymentBatchQuery = new URLSearchParams();
  if (selectedPaymentBatch) paymentBatchQuery.set("paymentBatchId", String(selectedPaymentBatch.id));

  return (
    <main className="page">
      <h1>Đối soát thanh toán</h1>

      <div className="tab-bar">
        <a className={`${view === "upload" ? "active" : ""}`} href="?view=upload">
          File Excel tải lên
        </a>
        <a className={`${view === "weekly" ? "active" : ""}`} href="?view=weekly">
          Thanh toán theo tuần · Drive
        </a>
      </div>

      {view === "upload" ? (
        <div className="two-col-layout">
          <div>
            <div className="card">
              <UploadForm />
            </div>

            <h3>Batches (upload tay)</h3>
            {batches.length === 0 ? (
              <p className="empty-state">Chưa có batch nào được upload.</p>
            ) : (
              <ul className="list-plain">
                {batches.map((batch) => (
                  <li key={batch.id}>
                    <a
                      className={`list-item-link${batch.id === selectedBatch?.id ? " active" : ""}`}
                      href={`?view=upload&batchId=${batch.id}`}
                    >
                      <span>{batch.fileName}</span>
                      <span className="list-item-meta">
                        {formatDateTimeVN(batch.uploadedAt)} · {batch.status}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            {selectedBatch ? (
              <>
                <h3 style={{ marginTop: 0 }}>
                  Batch {selectedBatch.id}: {selectedBatch.fileName}
                </h3>

                <div className="stat-card-grid">
                  <a className={`stat-card${!statusFilter ? " active" : ""}`} href={statCardHref(undefined)}>
                    <div className="stat-card-value">{batchResults.length}</div>
                    <div className="stat-card-label">Tất cả</div>
                  </a>
                  {countsByStatus.map((entry) => (
                    <a
                      key={entry.status}
                      className={`stat-card${statusFilter === entry.status ? " active" : ""}`}
                      href={statCardHref(entry.status)}
                    >
                      <div className="stat-card-value">{entry.count}</div>
                      <div className="stat-card-label">{MATCH_STATUS_LABELS[entry.status]}</div>
                    </a>
                  ))}
                </div>

                <p className="cell-muted">
                  Tổng chênh lệch: <strong className="cell-muted">{discrepancyTotal.toLocaleString("vi-VN")}</strong>
                </p>

                <Pagination
                  page={page}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  totalCount={filteredResults.length}
                  baseQuery={batchQuery.toString()}
                />

                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Mã đơn hàng</th>
                        <th>Trạng thái</th>
                        <th>Sheet amount</th>
                        <th>Excel amount</th>
                        <th>Chênh lệch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result) => {
                        const diff =
                          result.sheetAmount !== null && result.excelAmount !== null
                            ? result.excelAmount - result.sheetAmount
                            : null;
                        return (
                          <tr key={result.id}>
                            <td>{result.shopeeOrderId ?? "-"}</td>
                            <td>
                              <span className={matchStatusBadgeClass(result.matchStatus)}>
                                {MATCH_STATUS_LABELS[result.matchStatus]}
                              </span>
                            </td>
                            <td className="num">{formatAmount(result.sheetAmount)}</td>
                            <td className="num">{formatAmount(result.excelAmount)}</td>
                            <td className="num">{diff === null ? "-" : formatAmount(diff)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {results.length === 0 ? <p className="empty-state">Không có kết quả cho bộ lọc này.</p> : null}
                </div>
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  totalCount={filteredResults.length}
                  baseQuery={batchQuery.toString()}
                />
              </>
            ) : (
              <p className="empty-state">Chưa chọn batch nào.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="two-col-layout">
          <div>
            <h3 style={{ marginTop: 0 }}>Các tuần</h3>
            {paymentBatches.length === 0 ? (
              <p className="empty-state">Chưa có batch nào được đồng bộ.</p>
            ) : (
              <ul className="list-plain">
                {paymentBatches.map((batch) => (
                  <li key={batch.id}>
                    <a
                      className={`list-item-link${batch.id === selectedPaymentBatch?.id ? " active" : ""}`}
                      href={`?view=weekly&paymentBatchId=${batch.id}`}
                    >
                      <span>{batch.weekLabel}</span>
                      <span className="list-item-meta">đồng bộ lúc {formatDateTimeVN(batch.syncedAt)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            {selectedPaymentBatch && paymentBatchSums ? (
              <>
                <h3 style={{ marginTop: 0 }}>Batch: {selectedPaymentBatch.weekLabel}</h3>

                <div className="stat-card-grid">
                  <div className="stat-card">
                    <div className="stat-card-value">{formatAmount(paymentBatchSums._sum.sellPrice)}</div>
                    <div className="stat-card-label">Giá bán</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value">{formatAmount(paymentBatchSums._sum.serviceFee)}</div>
                    <div className="stat-card-label">Phí dịch vụ</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value">{formatAmount(paymentBatchSums._sum.taxDeduction)}</div>
                    <div className="stat-card-label">Khấu trừ thuế</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value">{formatAmount(paymentBatchSums._sum.netAmount)}</div>
                    <div className="stat-card-label">Còn lại</div>
                  </div>
                </div>

                <Pagination
                  page={pbPage}
                  totalPages={paymentBatchTotalPages}
                  pageSize={pbPageSize}
                  totalCount={paymentBatchLineTotal}
                  baseQuery={paymentBatchQuery.toString()}
                  pageParam="pbPage"
                  pageSizeParam="pbPageSize"
                />

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

                <Pagination
                  page={pbPage}
                  totalPages={paymentBatchTotalPages}
                  pageSize={pbPageSize}
                  totalCount={paymentBatchLineTotal}
                  baseQuery={paymentBatchQuery.toString()}
                  pageParam="pbPage"
                  pageSizeParam="pbPageSize"
                />
              </>
            ) : (
              <p className="empty-state">Chưa chọn tuần nào.</p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
