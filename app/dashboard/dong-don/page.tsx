import { prisma } from "@/lib/db";
import { ZaloGroupPicker } from "../ZaloGroupPicker";
import { ManualConfirmForm } from "./ManualConfirmForm";
import { WAYBILL_CONFIRM_PURPOSE } from "@/lib/zalo/poller";
import { formatDateTimeVN } from "@/lib/format/datetime";
import { getCurrentUser } from "@/lib/auth/currentUser";

export const dynamic = "force-dynamic";

export default async function DongDonPage() {
  const user = await getCurrentUser();
  const [config, logs, account] = await Promise.all([
    prisma.zaloWatchConfig.findUnique({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } }),
    prisma.zaloConfirmationLog.findMany({ orderBy: { confirmedAt: "desc" }, take: 20 }),
    // This account's saved choice of PDF layout (the page sits behind the sign-in check).
    user ? prisma.user.findUnique({ where: { id: user.id }, select: { waybillPerPage: true } }) : null,
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

      <h3>Lịch sử xác nhận đóng hàng</h3>
      {logs.length === 0 ? (
        <p className="empty-state">Chưa có xác nhận nào.</p>
      ) : (
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
                    ? `/api/waybills/${log.id}/pdf`
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
                          <a className="btn btn-info btn-sm" href={`/api/waybills/${log.id}/sorted-pdf`} target="_blank" rel="noreferrer">
                            Xem PDF đã xếp
                          </a>
                        ) : null}
                        {stored ? (
                          <a className="btn btn-success btn-sm" href={`/api/waybills/${log.id}/xlsx`}>
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
      )}
    </main>
  );
}
