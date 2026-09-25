import { prisma } from "@/lib/db";
import { ZaloWatchForm } from "./ZaloWatchForm";
import { ManualConfirmForm } from "./ManualConfirmForm";

export const dynamic = "force-dynamic";

export default async function ZaloPage() {
  const [config, logs] = await Promise.all([
    prisma.zaloWatchConfig.findUnique({ where: { id: 1 } }),
    prisma.zaloConfirmationLog.findMany({ orderBy: { confirmedAt: "desc" }, take: 20 }),
  ]);

  return (
    <main className="page">
      <h1>Zalo</h1>
      <p className="page-description">
        Chọn nhóm Zalo cần theo dõi. Khi đối tác gửi link phiếu giao hàng (PDF) và nhân viên reply "Đã in..." (phần sau
        không quan trọng) trong nhóm đó, hệ thống tự cập nhật trạng thái đóng hàng + ngày gửi cho các đơn trong file.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Đang theo dõi</h3>
        {config ? (
          <div className="summary-bar">
            <span className="stat-chip">
              Nhóm: <strong>{config.threadName}</strong>
            </span>
            <span className="stat-chip">Cập nhật lúc: {config.updatedAt.toLocaleString("vi-VN")}</span>
            {config.pendingPdfUrl ? (
              <span className="badge badge-warning">có link chờ xác nhận</span>
            ) : (
              <span className="badge">không có link chờ</span>
            )}
          </div>
        ) : (
          <p className="empty-state">Chưa chọn nhóm nào.</p>
        )}

        <ZaloWatchForm />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Nhập thủ công</h3>
        <p className="cell-muted" style={{ marginTop: 0 }}>
          Dùng khi Zalo không tự bắt được tin nhắn — dán link hoặc chọn file PDF phiếu vận đơn, chọn đúng ngày giờ đã
          gửi, xử lý y hệt như khi đồng bộ tự động từ Zalo.
        </p>
        <ManualConfirmForm />
      </div>

      <h2>Lịch sử xác nhận</h2>
      {logs.length === 0 ? (
        <p className="empty-state">Chưa có xác nhận nào.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Người xác nhận</th>
                <th>Số đơn trong file</th>
                <th>Số đơn khớp cập nhật</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const orderIds = Array.isArray(log.orderIds) ? (log.orderIds as string[]) : [];
                return (
                  <tr key={log.id}>
                    <td className="cell-muted">{log.confirmedAt.toLocaleString("vi-VN")}</td>
                    <td>{log.confirmedByName ?? "-"}</td>
                    <td className="num">{orderIds.length}</td>
                    <td className="num">{log.matchedCount}</td>
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
