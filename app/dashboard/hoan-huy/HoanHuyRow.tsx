"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { shopFetch, shopRefusal } from "@/lib/shops/shopFetch";

export interface HoanHuySummary {
  id: number;
  typeLabel: string;
  typeClassName: string;
  shopeeOrderId: string;
  trackingCode: string;
  productName: string;
  quantityMeta: string;
  // One return tracking code per line.
  returnTrackingCode: string;
  // "Trạng thái Trả hàng/Hoàn tiền" (sheet 5, column K) straight from the sheet ("-" when empty).
  returnRefundStatus: string;
  // "Trạng thái trả hàng" (sheet 5, column U).
  returnStatus: string;
  // "Thời gian hoàn trả hàng / ngày huỷ thành công".
  timeLabel: string;
  // "Trạng thái xử lý khiếu nại" (sheet 5, column AB).
  complaintStatus: string;
  respondByLabel: string;
  respondByClassName: string;
  // "" = no receipt entered yet; otherwise a CancelReceiptStatus value.
  receiptStatus: string;
  // "NCC ghi chú": the typed note, else the sheet's.
  supplierNote: string;
  refundAmountLabel: string;
  complaintReason: string;
}

export interface HoanHuyDetails {
  returnReason: string;
  buyerNote: string;
  shopeeNote: string;
  complaintAtLabel: string;
  // "TT khiếu nại huỷ", the note kept on the order's lines.
  complaintNote: string;
}

export interface ReceiptOption {
  value: string;
  label: string;
}

// Same colours as the report page's receipt badge: received is green, "không
// cần nhận" is plain (nothing to do), anything partial / outstanding is amber.
function receiptClassName(status: string): string {
  if (status === "received_full") return "hoan-huy-select receipt-ok";
  if (status === "not_needed" || status === "") return "hoan-huy-select";
  return "hoan-huy-select receipt-warn";
}

interface Edit {
  receiptStatus?: string | null;
  supplierNote?: string | null;
  complaintNote?: string | null;
}

// Sends one edit of this row and refreshes the page, so the filters and the tab counts (which
// depend on the receipt status) follow. False, with the reason shown, when it was not saved.
function useRowEdit(id: number) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function save(edit: Edit): Promise<boolean> {
    setSaving(true);
    try {
      const response = await shopFetch(`/api/hoan-huy/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(edit),
      });
      if (!response.ok) {
        window.alert((await shopRefusal(response)) ?? "Không lưu được, thử lại sau.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      window.alert("Không lưu được, kiểm tra mạng rồi thử lại.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { save, saving };
}

// A text that saves when you leave the box (or press Enter in the one-line box) and only if it changed.
function NoteBox({
  value,
  label,
  multiline,
  onSave,
  disabled,
}: {
  value: string;
  label: string;
  multiline?: boolean;
  onSave: (text: string) => Promise<boolean>;
  disabled: boolean;
}) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(value);

  async function commit() {
    if (text.trim() === saved.trim()) return;
    if (await onSave(text)) setSaved(text);
    else setText(saved);
  }

  if (multiline) {
    return (
      <textarea
        className="input hoan-huy-note"
        rows={2}
        maxLength={2000}
        value={text}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
      />
    );
  }
  return (
    <input
      className="input hoan-huy-note"
      type="text"
      maxLength={2000}
      value={text}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

// "Nút mở rộng" from the design — the low-traffic free-text fields (return
// reason, the notes, the complaint time) move into a collapsed second row
// instead of permanent columns, opened per-row on demand.
export function HoanHuyRow({
  summary,
  details,
  receiptOptions,
}: {
  summary: HoanHuySummary;
  details: HoanHuyDetails;
  receiptOptions: ReceiptOption[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [receipt, setReceipt] = useState(summary.receiptStatus);
  const { save, saving } = useRowEdit(summary.id);

  async function changeReceipt(next: string) {
    const before = receipt;
    setReceipt(next);
    if (!(await save({ receiptStatus: next || null }))) setReceipt(before);
  }

  return (
    <>
      <tr>
        <td>
          <span className={summary.typeClassName}>{summary.typeLabel}</span>
        </td>
        <td>
          <div className="cell-stack">
            <strong>{summary.shopeeOrderId}</strong>
            <span className="cell-sub">{summary.trackingCode}</span>
          </div>
        </td>
        <td className="cell-truncate" title={summary.productName}>
          <div className="cell-stack">
            <span>{summary.productName}</span>
            <span className="cell-sub">{summary.quantityMeta}</span>
          </div>
        </td>
        <td className="cell-codes">{summary.returnTrackingCode}</td>
        <td className="cell-wrap">{summary.returnRefundStatus}</td>
        <td className="cell-wrap">{summary.returnStatus}</td>
        <td className="cell-wrap">{summary.timeLabel}</td>
        <td className="cell-wrap">{summary.complaintStatus}</td>
        <td>
          <span className={summary.respondByClassName}>{summary.respondByLabel}</span>
        </td>
        <td className="cell-edit">
          <select
            className={receiptClassName(receipt)}
            value={receipt}
            disabled={saving}
            aria-label="Trạng thái nhận/Check Dup"
            onChange={(event) => changeReceipt(event.target.value)}
          >
            {receiptOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </td>
        <td className="cell-edit">
          <NoteBox value={summary.supplierNote} label="NCC ghi chú" disabled={saving} onSave={(text) => save({ supplierNote: text })} />
        </td>
        <td className="num">{summary.refundAmountLabel}</td>
        <td className="cell-truncate" title={summary.complaintReason}>
          {summary.complaintReason}
        </td>
        <td>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Thu gọn" : "Chi tiết"}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={14}>
            <div className="cell-stack" style={{ padding: "var(--space-2) 0" }}>
              <span>
                <strong className="cell-sub">Lí do trả hàng:</strong> {details.returnReason}
              </span>
              <span>
                <strong className="cell-sub">Ghi chú người mua:</strong> {details.buyerNote}
              </span>
              <span>
                <strong className="cell-sub">Ghi chú Shopee:</strong> {details.shopeeNote}
              </span>
              <span>
                <strong className="cell-sub">Thời gian khiếu nại:</strong> {details.complaintAtLabel}
              </span>
              <span className="hoan-huy-detail-edit">
                <strong className="cell-sub">TT khiếu nại huỷ:</strong>
                <NoteBox
                  value={details.complaintNote}
                  label="TT khiếu nại huỷ"
                  multiline
                  disabled={saving}
                  onSave={(text) => save({ complaintNote: text })}
                />
              </span>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
