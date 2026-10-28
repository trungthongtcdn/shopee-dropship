import { prisma } from "@/lib/db";
import { ZaloGroupPicker } from "../ZaloGroupPicker";
import { BarcodeScanForm } from "./BarcodeScanForm";
import { Pagination } from "../Pagination";
import { parsePage, parsePageSize, totalPagesFor } from "../pageSize";
import { CANCEL_RECEIPT_CONFIRM_PURPOSE } from "@/lib/zalo/cancelReceiptPoller";
import { formatDateTimeVN } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

export default async function DonHuyPage({
  searchParams,
}: {
  searchParams: { page?: string; pageSize?: string };
}) {
  const pageSize = parsePageSize(searchParams.pageSize);
  const totalCount = await prisma.zaloCancelReceiptLog.count();
  const totalPages = totalPagesFor(totalCount, pageSize);
  // A stale link (or a shrunk history) can point past the last page: show the last one.
  const page = Math.min(parsePage(searchParams.page), totalPages);
  const [config, logs] = await Promise.all([
    prisma.zaloWatchConfig.findUnique({ where: { purpose: CANCEL_RECEIPT_CONFIRM_PURPOSE } }),
    prisma.zaloCancelReceiptLog.findMany({
      orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return (
    <main className="page">
      <h1>Đơn huỷ</h1>

      <ZaloGroupPicker
        purpose={CANCEL_RECEIPT_CONFIRM_PURPOSE}
        threadName={config?.threadName ?? null}
        updatedAt={config ? formatDateTimeVN(config.updatedAt) : null}
      />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Quét mã đơn huỷ</h3>
        <BarcodeScanForm />
      </div>

      <h3>Lịch sử nhận đơn huỷ</h3>
      {totalCount === 0 ? (
        <p className="empty-state">Chưa có xác nhận nào.</p>
      ) : (
        <>
        <Pagination page={page} totalPages={totalPages} pageSize={pageSize} totalCount={totalCount} unit="xác nhận" />
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Người xác nhận</th>
                <th>Nội dung</th>
                <th>Mã dò được</th>
                <th>Số đơn khớp</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const codes = Array.isArray(log.codes) ? (log.codes as string[]) : [];
                return (
                  <tr key={log.id}>
                    <td className="cell-muted">{formatDateTimeVN(log.confirmedAt)}</td>
                    <td>{log.confirmedByName ?? "-"}</td>
                    <td className="cell-truncate" title={log.messageContent}>
                      {log.messageContent}
                    </td>
                    <td className="cell-muted">{codes.join(", ")}</td>
                    <td className="num">{log.matchedCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} pageSize={pageSize} totalCount={totalCount} unit="xác nhận" />
        </>
      )}
    </main>
  );
}
