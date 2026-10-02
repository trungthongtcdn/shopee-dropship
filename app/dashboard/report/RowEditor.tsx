"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const SEND_STATUS_BUTTON_OPTIONS = [
  { value: "", label: "Chưa gửi" },
  { value: "sent", label: "Đã gửi" },
  { value: "cancelled", label: "Huỷ" },
] as const;
const CANCEL_RECEIPT_OPTIONS = ["received_full", "not_received", "received_partial", "not_needed"] as const;

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
  paidAmountOverride: number | null;
  // Read-only header info (design: "Đầu popup: mã đơn, tên SP · phân loại ·
  // SL, dòng Cần thu … · Drive … · badge khớp") — all pre-formatted by the
  // caller, which already has the formatters/badge renderers from the table.
  shopeeOrderId: string;
  productMeta: string;
  amountSummary: string;
  paymentMatchBadge: ReactNode;
}

// Only the fields synced in automatically from Google Drive files (plus the
// two free-text manual fields) live here, behind a popup — everything else
// on the report row is read-only display in the table itself. Luân check
// is intentionally NOT part of this popup: it saves instantly from its own
// checkbox in the table (see LuanCheckToggle above), no popup needed.
//
// `open`/`onClose` are controlled by the caller (ReportTableRow) — clicking
// anywhere on the row opens this, not a dedicated "Sửa" button, so the
// open/close state has to live one level up, above the row's own click
// handler.
export function RowEditorModal(props: RowEditorProps & { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [sentAt, setSentAt] = useState(toDateInputValue(props.sentAt));
  const [sendStatus, setSendStatus] = useState(props.sendStatus ?? "");
  const [paidAt, setPaidAt] = useState(toDateInputValue(props.paidAt));
  const [cancelReceivedAt, setCancelReceivedAt] = useState(toDateInputValue(props.cancelReceivedAt));
  const [defectRatePercent, setDefectRatePercent] = useState(toPercentInputValue(props.defectRate));
  const [cancelReceiptStatus, setCancelReceiptStatus] = useState(props.cancelReceiptStatus ?? "");
  const [cancelComplaintNote, setCancelComplaintNote] = useState(props.cancelComplaintNote ?? "");
  const [note, setNote] = useState(props.note ?? "");
  const [paidAmountOverride, setPaidAmountOverride] = useState(
    props.paidAmountOverride === null ? "" : String(props.paidAmountOverride)
  );
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
        paidAmountOverride: paidAmountOverride === "" ? null : Number(paidAmountOverride),
      }),
    });

    if (response.ok) {
      setStatus(null);
      props.onClose();
      router.refresh();
    } else {
      setStatus("Lỗi khi lưu");
    }
  }

  if (!props.open) return null;

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <span>Cập nhật đơn</span>
          <button type="button" className="modal-close" onClick={props.onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        <div className="cell-stack" style={{ marginBottom: "var(--space-3)" }}>
          <strong>{props.shopeeOrderId}</strong>
          <span className="cell-sub">{props.productMeta}</span>
          <span className="cell-sub">
            {props.amountSummary} · {props.paymentMatchBadge}
          </span>
        </div>

        <h3 style={{ marginTop: 0 }}>Thanh toán</h3>
        <div className="field">
          <span className="field-label">Ngày đối soát</span>
          <input className="input" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
        <div className="field">
          <span className="field-label">Số tiền đối soát (trống = theo Drive)</span>
          <input
            className="input"
            type="number"
            step="1"
            value={paidAmountOverride}
            onChange={(e) => setPaidAmountOverride(e.target.value)}
          />
        </div>

        <h3>Đóng đơn</h3>
        <div className="field">
          <span className="field-label">Ngày gửi đơn</span>
          <input className="input" type="date" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
        </div>
        <div className="field">
          <span className="field-label">Trạng thái đóng đơn</span>
          <div style={{ display: "flex", gap: 6 }}>
            {SEND_STATUS_BUTTON_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`filter-pill${sendStatus === opt.value ? " active" : ""}`}
                onClick={() => setSendStatus(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <h3>Huỷ / hoàn</h3>
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
          <span className="field-label">Trạng thái nhận huỷ</span>
          <select className="select" value={cancelReceiptStatus} onChange={(e) => setCancelReceiptStatus(e.target.value)}>
            <option value="">-</option>
            {CANCEL_RECEIPT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value === "received_full"
                  ? "ĐÃ NHẬN ĐỦ"
                  : value === "not_received"
                    ? "CHƯA NHẬN"
                    : value === "received_partial"
                      ? "NHẬN THIẾU"
                      : "KHÔNG CẦN NHẬN"}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Tỷ lệ hỏng (%)</span>
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
          <span className="field-label">TT khiếu nại huỷ</span>
          <input
            className="input"
            type="text"
            value={cancelComplaintNote}
            onChange={(e) => setCancelComplaintNote(e.target.value)}
          />
        </div>

        <h3>Ghi chú</h3>
        <div className="field">
          <input className="input" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <p className="cell-sub" style={{ margin: "var(--space-2) 0" }}>
          Thông tin đồng bộ từ Sheet/Drive chỉ xem.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={save}>
            Lưu
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={props.onClose}>
            Huỷ
          </button>
          {status && <span className="editor-status">{status}</span>}
        </div>
      </div>
    </div>
  );
}
