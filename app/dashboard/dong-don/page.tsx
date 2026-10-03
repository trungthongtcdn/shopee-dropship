import { prisma } from "@/lib/db";
import { ZaloGroupPicker } from "../ZaloGroupPicker";
import { ManualConfirmForm } from "./ManualConfirmForm";
import { WAYBILL_CONFIRM_PURPOSE } from "@/lib/zalo/poller";
import { formatDateTimeVN } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

export default async function DongDonPage() {
  const [config, logs] = await Promise.all([
    prisma.zaloWatchConfig.findUnique({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } }),
    prisma.zaloConfirmationLog.findMany({ orderBy: { confirmedAt: "desc" }, take: 20 }),
  ]);

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
          <ManualConfirmForm />
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
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const orderIds = Array.isArray(log.orderIds) ? (log.orderIds as string[]) : [];
                const pct = orderIds.length > 0 ? Math.round((log.matchedCount / orderIds.length) * 100) : 0;
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
                      {log.pdfUrl.startsWith("http") ? (
                        <a href={log.pdfUrl} target="_blank" rel="noreferrer">
                          Xem PDF
                        </a>
                      ) : (
                        <span className="cell-muted">{log.pdfUrl}</span>
                      )}
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
