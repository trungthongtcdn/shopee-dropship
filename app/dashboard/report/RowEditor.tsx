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

export function LuanCheckToggle({ orderId, luanCheck }: { orderId: number; luanCheck: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(luanCheck);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    setChecked(next);
    setSaving(true);
    const response = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ luanCheck: next }),
    });
    setSaving(false);
    if (response.ok) {
      router.refresh();
    } else {
      setChecked(!next);
    }
  }

  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={saving}
      onChange={(e) => toggle(e.target.checked)}
      aria-label="Luân check"
    />
  );
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
}

// Only the fields synced in automatically from Google Drive files (plus the
// two free-text manual fields) live here, behind a popup — everything else
// on the report row is read-only display in the table itself. Luân check
// is intentionally NOT part of this popup: it saves instantly from its own
// checkbox in the table (see LuanCheckToggle above), no popup needed.
export function RowEditor(props: RowEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sentAt, setSentAt] = useState(toDateInputValue(props.sentAt));
  const [sendStatus, setSendStatus] = useState(props.sendStatus ?? "");
  const [paidAt, setPaidAt] = useState(toDateInputValue(props.paidAt));
  const [cancelReceivedAt, setCancelReceivedAt] = useState(toDateInputValue(props.cancelReceivedAt));
  const [defectRatePercent, setDefectRatePercent] = useState(toPercentInputValue(props.defectRate));
  const [cancelReceiptStatus, setCancelReceiptStatus] = useState(props.cancelReceiptStatus ?? "");
  const [cancelComplaintNote, setCancelComplaintNote] = useState(props.cancelComplaintNote ?? "");
  const [note, setNote] = useState(props.note ?? "");
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
      }),
    });

    if (response.ok) {
      setStatus(null);
      setOpen(false);
      router.refresh();
    } else {
      setStatus("Lỗi khi lưu");
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        Sửa
      </button>
      {open ? (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>Sửa thông tin đơn</span>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Đóng">
                ×
              </button>
            </div>

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
              <input
                className="input"
                type="date"
                value={cancelReceivedAt}
                onChange={(e) => setCancelReceivedAt(e.target.value)}
              />
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
              <input
                className="input"
                type="text"
                value={cancelComplaintNote}
                onChange={(e) => setCancelComplaintNote(e.target.value)}
              />
            </div>
            <div className="field">
              <span className="field-label">Ghi chú</span>
              <input className="input" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={save}>
                Lưu
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
                Huỷ
              </button>
              {status && <span className="editor-status">{status}</span>}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
