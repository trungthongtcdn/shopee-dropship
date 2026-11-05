import { prisma, sharedPrisma } from "@/lib/db";
import { ZaloGroupPicker } from "../ZaloGroupPicker";
import { Pagination } from "../Pagination";
import { parsePage, parsePageSize, totalPagesFor } from "../pageSize";
import Link from "next/link";
import { ManualConfirmForm } from "./ManualConfirmForm";
import { WAYBILL_CONFIRM_PURPOSE } from "@/lib/zalo/poller";
import { formatDateTimeVN } from "@/lib/format/datetime";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { currentShopSlug } from "@/lib/shops/context";

export const dynamic = "force-dynamic";

export default async function DongDonPage({
  searchParams,
}: {
  searchParams: { page?: string; pageSize?: string };
}) {
  const shopSlug = currentShopSlug();
  const user = await getCurrentUser();
  const pageSize = parsePageSize(searchParams.pageSize);
  const totalCount = await prisma.zaloConfirmationLog.count();
  const totalPages = totalPagesFor(totalCount, pageSize);
  // A stale link (or a shrunk history) can point past the last page: show the last one.
  const page = Math.min(parsePage(searchParams.page), totalPages);
  const [config, logs, account, drafts] = await Promise.all([
    prisma.zaloWatchConfig.findUnique({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } }),
    prisma.zaloConfirmationLog.findMany({
      orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    // This account's saved choice of PDF layout (the page sits behind the sign-in check).
    user ? sharedPrisma.user.findUnique({ where: { id: user.id }, select: { waybillPerPage: true } }) : null,
    // The PDFs the bot read from the group lately, to open again (the link in the group may be lost).
    // Counted in SQL so the orders themselves aren't pulled into a list page.
    prisma.$queryRaw<{ id: number; created_at: Date; sent_at: Date | null; orders: number }[]>`
      SELECT id, created_at, sent_at, jsonb_array_length(pages)::int AS orders
      FROM waybill_drafts ORDER BY created_at DESC, id DESC LIMIT 10`,
  ]);

  // Which of these rows have a stored Excel / re-ordered PDF / uploaded PDF. Names
  // only — never pull the bytea columns into a list page. Rows logged before the
  // grouped-Excel feature have no file and keep just the plain "Xem PDF" link.
  const storedFiles = await prisma.waybillFile.findMany({
    where: { confirmationLogId: { in: logs.map((log) => log.id) } },
    select: { confirmationLogId: true, pdfName: true, sortedPdfName: true },
  });
  const storedByLogId = new Map(storedFiles.map((file) => [file.confirmationLogId, file]));

  return (
    <main className="page">
      <h1>Đóng đơn</h1>

      <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "stretch", flexWrap: "wrap" }}>
        <div className="card" style={{ flex: 1, minWidth: 320, marginBottom: 0 }}>
          <h3 style={{ marginTop: 0 }}>Nhóm Zalo</h3>
          <ZaloGroupPicker
            purpose={WAYBILL_CONFIRM_PURPOSE}
            threadName={config?.threadName ?? null}
            updatedAt={config ? formatDateTimeVN(config.updatedAt) : null}
            extra={
              <>
                {config?.threadName ? <span className="badge badge-success">Đang theo dõi</span> : null}
                {config?.pendingPdfUrl ? <span className="badge badge-warning">1 link PDF đang chờ</span> : null}
              </>
            }
          />
        </div>

        <div className="card" style={{ flex: 1, minWidth: 320, marginBottom: 0 }}>
          <h3 style={{ marginTop: 0 }}>Xác nhận thủ công</h3>
          <ManualConfirmForm defaultPerPage={account?.waybillPerPage ?? null} />
        </div>
      </div>

      <h3>Phiếu bot đã đọc từ nhóm Zalo</h3>
      {drafts.length === 0 ? (
        <p className="empty-state">Chưa có phiếu nào (phiếu được giữ 14 ngày).</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Số đơn</th>
                <th>File Excel/PDF</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => (
                <tr key={draft.id}>
                  <td className="cell-muted">{formatDateTimeVN(draft.created_at)}</td>
                  <td>{draft.orders}</td>
                  <td>
                    {draft.sent_at ? (
                      <span className="badge badge-success">Đã gửi {formatDateTimeVN(draft.sent_at)}</span>
                    ) : (
                      <span className="badge badge-warning">Chưa gửi — chờ chọn kho gửi</span>
                    )}
                  </td>
                  <td>
                    <Link className="btn btn-secondary btn-sm" href={`/dashboard/dong-don/phieu/${draft.id}`}>
                      Xem / sửa kho gửi
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Lịch sử xác nhận đóng hàng</h3>
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
                <th>Khớp / trong file</th>
                <th>Xem file</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const orderIds = Array.isArray(log.orderIds) ? (log.orderIds as string[]) : [];
                const pct = orderIds.length > 0 ? Math.round((log.matchedCount / orderIds.length) * 100) : 0;
                const stored = storedByLogId.get(log.id);
                // A link PDF opens from its own URL; an uploaded one only exists
                // in our database (pdfName is set exactly when it was kept).
                const pdfHref = log.pdfUrl.startsWith("http")
                  ? log.pdfUrl
                  : stored?.pdfName
                    ? `/api/waybills/${log.id}/pdf?shop=${shopSlug}`
                    : null;
                return (
                  <tr key={log.id}>
                    <td className="cell-muted">{formatDateTimeVN(log.confirmedAt)}</td>
                    <td>{log.confirmedByName ?? "-"}</td>
                    <td>
                      <div className="ratio-bar-wrap">
                        <div className="ratio-bar">
                          <div className="ratio-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="cell-muted">
                          {log.matchedCount} / {orderIds.length}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="btn-group">
                        {pdfHref ? (
                          <a className="btn btn-secondary btn-sm" href={pdfHref} target="_blank" rel="noreferrer">
                            Xem PDF
                          </a>
                        ) : (
                          <span className="cell-muted">{log.pdfUrl}</span>
                        )}
                        {stored?.sortedPdfName ? (
                          <a className="btn btn-info btn-sm" href={`/api/waybills/${log.id}/sorted-pdf?shop=${shopSlug}`} target="_blank" rel="noreferrer">
                            Xem PDF đã xếp
                          </a>
                        ) : null}
                        {stored ? (
                          <a className="btn btn-success btn-sm" href={`/api/waybills/${log.id}/xlsx?shop=${shopSlug}`}>
                            Xem excel
                          </a>
                        ) : null}
                      </div>
                    </td>
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
