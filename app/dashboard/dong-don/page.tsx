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
      <p className="page-description">
        Chọn nhóm Zalo cần theo dõi. Khi đối tác gửi link phiếu giao hàng (PDF) và nhân viên reply "Đã in..." (phần sau
        không quan trọng) trong nhóm đó, hệ thống tự cập nhật trạng thái đóng hàng + ngày gửi cho các đơn trong file.
      </p>

      <ZaloGroupPicker
        purpose={WAYBILL_CONFIRM_PURPOSE}
        threadName={config?.threadName ?? null}
        updatedAt={config ? formatDateTimeVN(config.updatedAt) : null}
        extra={
          config ? (
            config.pendingPdfUrl ? (
              <span className="badge badge-warning">có link chờ xác nhận</span>
            ) : (
              <span className="badge">không có link chờ</span>
            )
          ) : null
        }
      />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Nhập thủ công</h3>
        <p className="cell-muted" style={{ marginTop: 0 }}>
          Dùng khi Zalo không tự bắt được tin nhắn — dán link hoặc chọn file PDF phiếu vận đơn, chọn đúng ngày giờ đã
          gửi, xử lý y hệt như khi đồng bộ tự động từ Zalo.
        </p>
        <ManualConfirmForm />
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
                    <td className="cell-muted">{formatDateTimeVN(log.confirmedAt)}</td>
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
