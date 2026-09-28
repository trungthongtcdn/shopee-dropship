import { prisma } from "@/lib/db";
import { ZaloWatchForm } from "./ZaloWatchForm";
import { ManualConfirmForm } from "./ManualConfirmForm";
import { WAYBILL_CONFIRM_PURPOSE } from "@/lib/zalo/poller";
import { CANCEL_RECEIPT_CONFIRM_PURPOSE } from "@/lib/zalo/cancelReceiptPoller";

export const dynamic = "force-dynamic";

export default async function ZaloPage() {
  const [waybillConfig, waybillLogs, cancelReceiptConfig, cancelReceiptLogs] = await Promise.all([
    prisma.zaloWatchConfig.findUnique({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } }),
    prisma.zaloConfirmationLog.findMany({ orderBy: { confirmedAt: "desc" }, take: 20 }),
    prisma.zaloWatchConfig.findUnique({ where: { purpose: CANCEL_RECEIPT_CONFIRM_PURPOSE } }),
    prisma.zaloCancelReceiptLog.findMany({ orderBy: { confirmedAt: "desc" }, take: 20 }),
  ]);

  return (
    <main className="page">
      <h1>Zalo</h1>

      <h2>Nhóm cập nhật đóng hàng</h2>
      <p className="page-description">
        Chọn nhóm Zalo cần theo dõi. Khi đối tác gửi link phiếu giao hàng (PDF) và nhân viên reply "Đã in..." (phần sau
        không quan trọng) trong nhóm đó, hệ thống tự cập nhật trạng thái đóng hàng + ngày gửi cho các đơn trong file.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Đang theo dõi</h3>
        {waybillConfig ? (
          <div className="summary-bar">
            <span className="stat-chip">
              Nhóm: <strong>{waybillConfig.threadName}</strong>
            </span>
            <span className="stat-chip">Cập nhật lúc: {waybillConfig.updatedAt.toLocaleString("vi-VN")}</span>
            {waybillConfig.pendingPdfUrl ? (
              <span className="badge badge-warning">có link chờ xác nhận</span>
            ) : (
              <span className="badge">không có link chờ</span>
            )}
          </div>
        ) : (
          <p className="empty-state">Chưa chọn nhóm nào.</p>
        )}

        <ZaloWatchForm purpose={WAYBILL_CONFIRM_PURPOSE} />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Nhập thủ công</h3>
        <p className="cell-muted" style={{ marginTop: 0 }}>
          Dùng khi Zalo không tự bắt được tin nhắn — dán link hoặc chọn file PDF phiếu vận đơn, chọn đúng ngày giờ đã
          gửi, xử lý y hệt như khi đồng bộ tự động từ Zalo.
        </p>
        <ManualConfirmForm />
      </div>

      <h3>Lịch sử xác nhận đóng hàng</h3>
      {waybillLogs.length === 0 ? (
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
              {waybillLogs.map((log) => {
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

      <h2>Nhóm cập nhật đơn huỷ</h2>
      <p className="page-description">
        Chọn nhóm Zalo báo đơn huỷ. Bất kỳ tin nhắn nào trong nhóm này có nhắc mã đơn hàng và/hoặc mã vận đơn đều được
        hiểu là đơn đó đã nhận huỷ thành công — hệ thống tự đặt "Trạng thái nhận huỷ" = "Đã nhận đủ" và "Ngày nhận đơn
        huỷ" = đúng ngày giờ tin nhắn được gửi.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Đang theo dõi</h3>
        {cancelReceiptConfig ? (
          <div className="summary-bar">
            <span className="stat-chip">
              Nhóm: <strong>{cancelReceiptConfig.threadName}</strong>
            </span>
            <span className="stat-chip">Cập nhật lúc: {cancelReceiptConfig.updatedAt.toLocaleString("vi-VN")}</span>
          </div>
        ) : (
          <p className="empty-state">Chưa chọn nhóm nào.</p>
        )}

        <ZaloWatchForm purpose={CANCEL_RECEIPT_CONFIRM_PURPOSE} />
      </div>

      <h3>Lịch sử nhận đơn huỷ</h3>
      {cancelReceiptLogs.length === 0 ? (
        <p className="empty-state">Chưa có xác nhận nào.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Thời gian tin nhắn</th>
                <th>Người gửi</th>
                <th>Nội dung</th>
                <th>Mã dò được</th>
                <th>Số đơn khớp</th>
              </tr>
            </thead>
            <tbody>
              {cancelReceiptLogs.map((log) => {
                const codes = Array.isArray(log.codes) ? (log.codes as string[]) : [];
                return (
                  <tr key={log.id}>
                    <td className="cell-muted">{log.confirmedAt.toLocaleString("vi-VN")}</td>
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
      )}
    </main>
  );
}
