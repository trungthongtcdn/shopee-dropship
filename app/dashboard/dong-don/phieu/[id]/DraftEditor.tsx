"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { shopFetch, shopRefusal } from "@/lib/shops/shopFetch";
import { KHO_REASON_TEXT, NO_KHO_LABEL } from "@/lib/waybill/khoGiao";
import type { KhoSummary } from "@/lib/waybill/khoSummary";

interface SendResult {
  excelSent: boolean;
  pdfSent: boolean;
  tooLarge?: string;
  khoSent: number;
  khoFailed: number;
}

const khoText = (kho: string) => (kho === "" ? NO_KHO_LABEL : kho);

export function DraftEditor({
  draftId,
  shopSlug,
  summary,
  sentAtLabel,
  threadIsGroup,
}: {
  draftId: number;
  shopSlug: string;
  summary: KhoSummary;
  sentAtLabel: string | null;
  threadIsGroup: boolean;
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, string>>(() => Object.fromEntries(summary.orders.map((order) => [order.orderId, order.kho])));
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const choice = (orderId: string, fallback: string) => choices[orderId] ?? fallback;
  const changed = summary.orders.filter((order) => choice(order.orderId, order.kho) !== order.kho).length;
  const blankNow = summary.orders.filter((order) => choice(order.orderId, order.kho) === "").length;
  // What differs from the price sheet's own decision: the only thing worth saving.
  const overrides = () =>
    Object.fromEntries(summary.orders.filter((order) => choice(order.orderId, order.kho) !== order.auto).map((order) => [order.orderId, choice(order.orderId, order.kho)]));

  async function call(path: string, method: "PATCH" | "POST", body: unknown): Promise<Response | null> {
    try {
      const response = await shopFetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        setMessage((await shopRefusal(response)) ?? "Không thực hiện được, thử lại sau.");
        return null;
      }
      return response;
    } catch {
      setMessage("Không thực hiện được, kiểm tra mạng rồi thử lại.");
      return null;
    }
  }

  async function save() {
    setBusy("save");
    setMessage(null);
    const ok = await call(`/api/waybill-drafts/${draftId}`, "PATCH", { khoOverrides: overrides() });
    setBusy(null);
    if (ok) {
      setMessage("Đã lưu kho gửi.");
      router.refresh();
    }
  }

  async function send() {
    if (sentAtLabel && !window.confirm(`File của phiếu này đã được gửi vào nhóm lúc ${sentAtLabel}. Gửi lại?`)) return;
    if (blankNow > 0 && !window.confirm(`Còn ${blankNow} đơn chưa có kho gửi — chúng sẽ nằm trong file riêng "${NO_KHO_LABEL}". Vẫn gửi?`)) return;
    setBusy("send");
    setMessage(null);
    const response = await call(`/api/waybill-drafts/${draftId}/send`, "POST", { khoOverrides: overrides() });
    setBusy(null);
    if (!response) return;
    const result = (await response.json()) as SendResult;
    if (!result.excelSent && !result.pdfSent) setMessage("Không gửi được file vào nhóm Zalo (bridge từ chối hoặc đang lỗi). Thử lại sau, hoặc tải file về ở dưới.");
    else {
      const parts = [`Đã gửi file vào nhóm Zalo${result.khoSent ? ` (kèm ${result.khoSent} file theo kho)` : ""}.`];
      if (result.tooLarge) parts.push(`PDF tổng nặng ${result.tooLarge}, vượt giới hạn gửi Zalo nên chỉ gửi được Excel — tải PDF ở dưới.`);
      if (result.khoFailed) parts.push(`${result.khoFailed} file theo kho không gửi được.`);
      setMessage(parts.join(" "));
    }
    router.refresh();
  }

  const options = (value: string) => {
    const all = summary.options.includes(value) || value === "" ? summary.options : [...summary.options, value];
    return ["", ...all];
  };
  const download = (file: string, index?: number) =>
    `/api/waybill-drafts/${draftId}/file?file=${file}${index === undefined ? "" : `&i=${index}`}&shop=${encodeURIComponent(shopSlug)}`;
  const fileGroups = summary.groups.length > 1 ? summary.groups : [];
  const dirty = changed > 0;

  return (
    <div className="draft-editor">
      <div className="card" style={{ marginBottom: "var(--space-4)" }}>
        <p style={{ margin: 0 }}>
          <strong>{summary.orders.length} đơn</strong> ·{" "}
          {summary.groups.map((group) => `${khoText(group.kho)}: ${group.orderCount}`).join(" · ")} ·{" "}
          {sentAtLabel ? <span className="badge badge-success">Đã gửi vào nhóm {sentAtLabel}</span> : <span className="badge badge-warning">Chưa gửi vào nhóm</span>}
          {summary.edited > 0 ? <span className="badge"> {summary.edited} đơn đã sửa kho</span> : null}
        </p>
        <p className="cell-muted" style={{ marginBottom: 0 }}>
          Kho gửi lấy theo bảng GIÁ FULL. Đơn có các mã Kiot nằm ở 2 kho khác nhau, hoặc chưa tra được kho, để trống để chọn tay. Chọn xong bấm “Lưu” rồi “Gửi file vào nhóm Zalo”
          {threadIsGroup ? "" : " (gửi cho người đã gửi PDF)"}. Cột SKU / Mã Kiot là căn cứ để chọn kho.
        </p>
      </div>

      <div className="table-wrap draft-wrap">
        <table className="data-table draft-table">
          <thead>
            <tr>
              <th>STT</th>
              <th>Mã đơn</th>
              <th>Mã vận đơn</th>
              <th>Shop</th>
              <th>Sản phẩm</th>
              <th>SKU / Mã Kiot</th>
              <th>Kho gửi</th>
              <th>Theo bảng</th>
            </tr>
          </thead>
          <tbody>
            {summary.orders.map((order, index) => {
              const value = choice(order.orderId, order.kho);
              return (
                <tr key={order.orderId} className={value === "" ? "draft-blank" : value !== order.auto ? "draft-edited" : undefined}>
                  <td>{index + 1}</td>
                  <td>{order.orderId}</td>
                  <td>{order.trackingCode ?? ""}</td>
                  <td>{order.shopName}</td>
                  <td className="draft-product" title={order.products}>
                    {order.products}
                  </td>
                  <td className="draft-codes">
                    {order.lines.length > 0 ? (
                      order.lines.map((line, lineIndex) => (
                        <div key={lineIndex}>
                          <strong>{line.code}</strong> ×{line.quantity}
                          {line.kho ? <span className="cell-muted"> · {line.kho}</span> : null}
                        </div>
                      ))
                    ) : (
                      <span className="cell-muted">Chưa có mã</span>
                    )}
                  </td>
                  <td>
                    <select
                      className="draft-select"
                      value={value}
                      aria-label={`Kho gửi của đơn ${order.orderId}`}
                      onChange={(event) => setChoices((current) => ({ ...current, [order.orderId]: event.target.value }))}
                    >
                      {options(value).map((option) => (
                        <option key={option || "none"} value={option}>
                          {option === "" ? "(chưa chọn)" : option}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{value !== order.auto ? `Đã sửa (bảng: ${order.auto || "trống"})` : KHO_REASON_TEXT[order.reason]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="toolbar" style={{ marginTop: "var(--space-4)" }}>
        <button type="button" className="btn btn-primary" disabled={busy !== null || !dirty} onClick={save}>
          {busy === "save" ? "Đang lưu…" : `Lưu kho gửi${dirty ? ` (${changed} đơn)` : ""}`}
        </button>
        <button type="button" className="btn btn-success" disabled={busy !== null} onClick={send}>
          {busy === "send" ? "Đang gửi…" : "Gửi file vào nhóm Zalo"}
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy !== null || !dirty} onClick={() => setChoices(Object.fromEntries(summary.orders.map((order) => [order.orderId, order.kho])))}>
          Bỏ thay đổi chưa lưu
        </button>
        <span role="status">{message}</span>
      </div>

      <h3>Tải file</h3>
      {dirty ? <p className="cell-muted">Có thay đổi chưa lưu: bấm “Lưu kho gửi” trước, file tải về mới theo kho vừa chọn.</p> : null}
      <div className="btn-group">
        <a className="btn btn-success btn-sm" href={download("excel")}>
          Excel tổng ({summary.orders.length} đơn)
        </a>
        <a className="btn btn-info btn-sm" href={download("pdf")}>
          PDF tổng
        </a>
      </div>
      {fileGroups.length > 0 ? (
        <div className="draft-kho-files">
          {fileGroups.map((group, index) => (
            <div key={group.kho || "none"} className="draft-kho-row">
              <span>
                {khoText(group.kho)} ({group.orderCount} đơn)
              </span>
              <a className="btn btn-success btn-sm" href={download("kho-excel", index)}>
                Excel
              </a>
              <a className="btn btn-info btn-sm" href={download("kho-pdf", index)}>
                PDF
              </a>
            </div>
          ))}
        </div>
      ) : (
        <p className="cell-muted">Tất cả {summary.orders.length} đơn cùng một kho nên không tách file theo kho.</p>
      )}
    </div>
  );
}
