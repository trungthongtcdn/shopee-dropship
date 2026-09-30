import { prisma } from "@/lib/db";
import { ZaloGroupPicker } from "../ZaloGroupPicker";
import { BarcodeScanForm } from "./BarcodeScanForm";
import { CANCEL_RECEIPT_CONFIRM_PURPOSE } from "@/lib/zalo/cancelReceiptPoller";

export const dynamic = "force-dynamic";

export default async function DonHuyPage() {
  const [config, logs] = await Promise.all([
    prisma.zaloWatchConfig.findUnique({ where: { purpose: CANCEL_RECEIPT_CONFIRM_PURPOSE } }),
    prisma.zaloCancelReceiptLog.findMany({ orderBy: { confirmedAt: "desc" }, take: 20 }),
  ]);

  return (
    <main className="page">
      <h1>Đơn huỷ</h1>
      <p className="page-description">
        Chọn nhóm Zalo báo đơn huỷ. Bất kỳ tin nhắn nào trong nhóm này có nhắc mã đơn hàng và/hoặc mã vận đơn đều được
        hiểu là đơn đó đã nhận huỷ thành công — hệ thống tự đặt "Trạng thái nhận huỷ" = "Đã nhận đủ" và "Ngày nhận đơn
        huỷ" = đúng ngày giờ tin nhắn được gửi. Hoặc quét mã / nhập tay bên dưới khi kiểm hàng thực tế.
      </p>

      <ZaloGroupPicker
        purpose={CANCEL_RECEIPT_CONFIRM_PURPOSE}
        threadName={config?.threadName ?? null}
        updatedAt={config ? config.updatedAt.toLocaleString("vi-VN") : null}
      />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Quét mã đơn huỷ</h3>
        <p className="cell-muted" style={{ marginTop: 0 }}>
          Quét barcode bằng camera hoặc nhập tay mã đơn hàng/mã vận đơn, gom thành danh sách rồi xác nhận 1 lần.
        </p>
        <BarcodeScanForm />
      </div>

      <h3>Lịch sử nhận đơn huỷ</h3>
      {logs.length === 0 ? (
        <p className="empty-state">Chưa có xác nhận nào.</p>
      ) : (
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
