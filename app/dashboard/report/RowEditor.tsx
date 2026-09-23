"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SEND_STATUS_OPTIONS = ["sent", "cancelled"] as const;
const CANCEL_RECEIPT_OPTIONS = ["received_full", "not_received", "received_partial"] as const;

function toDateInputValue(iso: string | null) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function toPercentInputValue(fraction: number | null) {
  if (fraction === null) return "";
  return String(Math.round(fraction * 1000) / 10);
}

export interface RowEditorProps {
  orderId: number;
  sentAt: string | null;
  sendStatus: string | null;
  paidAt: string | null;
  cancelReceivedAt: string | null;
  defectRate: number | null;
  cancelReceiptStatus: string | null;
  cancelComplaintNote: string | null;
  note: string | null;
  luanCheck: boolean;
}

export function RowEditor(props: RowEditorProps) {
  const router = useRouter();
  const [sentAt, setSentAt] = useState(toDateInputValue(props.sentAt));
  const [sendStatus, setSendStatus] = useState(props.sendStatus ?? "");
  const [paidAt, setPaidAt] = useState(toDateInputValue(props.paidAt));
  const [cancelReceivedAt, setCancelReceivedAt] = useState(toDateInputValue(props.cancelReceivedAt));
  const [defectRatePercent, setDefectRatePercent] = useState(toPercentInputValue(props.defectRate));
  const [cancelReceiptStatus, setCancelReceiptStatus] = useState(props.cancelReceiptStatus ?? "");
  const [cancelComplaintNote, setCancelComplaintNote] = useState(props.cancelComplaintNote ?? "");
  const [note, setNote] = useState(props.note ?? "");
  const [luanCheck, setLuanCheck] = useState(props.luanCheck);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setStatus("Đang lưu...");
    const defectRate = defectRatePercent === "" ? null : Number(defectRatePercent) / 100;

    const response = await fetch(`/api/orders/${props.orderId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sentAt: sentAt ? new Date(sentAt).toISOString() : null,
        sendStatus: sendStatus || null,
        paidAt: paidAt ? new Date(paidAt).toISOString() : null,
        cancelReceivedAt: cancelReceivedAt ? new Date(cancelReceivedAt).toISOString() : null,
        defectRate,
        cancelReceiptStatus: cancelReceiptStatus || null,
        cancelComplaintNote: cancelComplaintNote || null,
        note: note || null,
        luanCheck,
      }),
    });

    if (response.ok) {
      setStatus("Đã lưu");
      router.refresh();
    } else {
      setStatus("Lỗi khi lưu");
    }
  }

  return (
    <details className="editor-details">
      <summary className="editor-summary">
        {luanCheck ? <span className="badge badge-success">đã check</span> : <span className="badge">chưa check</span>}
        {sendStatus ? <span className="cell-muted">{sendStatus === "sent" ? "đã gửi" : "huỷ"}</span> : null}
        <span className="editor-summary-action">Sửa ▾</span>
      </summary>
      <div style={{ minWidth: 220, marginTop: "var(--space-2)" }}>
      <div className="field">
        <span className="field-label">Ngày gửi đơn</span>
        <input className="input" type="date" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
      </div>
      <div className="field">
        <span className="field-label">Trạng thái đóng đơn</span>
        <select className="select" value={sendStatus} onChange={(e) => setSendStatus(e.target.value)}>
          <option value="">-</option>
          {SEND_STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value === "sent" ? "ĐÃ GỬI" : "HUỶ"}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="field-label">Ngày thanh toán</span>
        <input className="input" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </div>
      <div className="field">
        <span className="field-label">Ngày nhận đơn huỷ</span>
        <input className="input" type="date" value={cancelReceivedAt} onChange={(e) => setCancelReceivedAt(e.target.value)} />
      </div>
      <div className="field">
        <span className="field-label">% hỏng</span>
        <input
          className="input"
          type="number"
          step="0.1"
          min="0"
          max="100"
          value={defectRatePercent}
          onChange={(e) => setDefectRatePercent(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="field-label">Trạng thái nhận huỷ</span>
        <select className="select" value={cancelReceiptStatus} onChange={(e) => setCancelReceiptStatus(e.target.value)}>
          <option value="">-</option>
          {CANCEL_RECEIPT_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value === "received_full" ? "ĐÃ NHẬN ĐỦ" : value === "not_received" ? "CHƯA NHẬN" : "NHẬN THIẾU"}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="field-label">TT khiếu nại huỷ</span>
        <input className="input" type="text" value={cancelComplaintNote} onChange={(e) => setCancelComplaintNote(e.target.value)} />
      </div>
      <div className="field">
        <span className="field-label">Ghi chú</span>
        <input className="input" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <label className="field field-checkbox">
        <input type="checkbox" checked={luanCheck} onChange={(e) => setLuanCheck(e.target.checked)} />
        Luân check (DONE)
      </label>
      <button type="button" className="btn btn-primary btn-sm" onClick={save}>
        Lưu
      </button>
      {status && <div className="editor-status">{status}</div>}
      </div>
    </details>
  );
}
