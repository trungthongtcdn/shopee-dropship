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
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
      <label>
        Ngày gửi đơn: <input type="date" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
      </label>
      <label>
        Trạng thái đóng đơn:{" "}
        <select value={sendStatus} onChange={(e) => setSendStatus(e.target.value)}>
          <option value="">-</option>
          {SEND_STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value === "sent" ? "ĐÃ GỬI" : "HUỶ"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Ngày thanh toán: <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </label>
      <label>
        % hỏng:{" "}
        <input
          type="number"
          step="0.1"
          min="0"
          max="100"
          value={defectRatePercent}
          onChange={(e) => setDefectRatePercent(e.target.value)}
        />
      </label>
      <label>
        Trạng thái nhận huỷ:{" "}
        <select value={cancelReceiptStatus} onChange={(e) => setCancelReceiptStatus(e.target.value)}>
          <option value="">-</option>
          {CANCEL_RECEIPT_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value === "received_full" ? "ĐÃ NHẬN ĐỦ" : value === "not_received" ? "CHƯA NHẬN" : "NHẬN THIẾU"}
            </option>
          ))}
        </select>
      </label>
      <label>
        TT khiếu nại huỷ: <input type="text" value={cancelComplaintNote} onChange={(e) => setCancelComplaintNote(e.target.value)} />
      </label>
      <label>
        Ghi chú: <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label>
        <input type="checkbox" checked={luanCheck} onChange={(e) => setLuanCheck(e.target.checked)} /> Luân check (DONE)
      </label>
      <button type="button" onClick={save}>
        Lưu
      </button>
      {status && <span>{status}</span>}
    </div>
  );
}
