"use client";

import { useState, type ReactNode } from "react";
import { LuanCheckToggle, RowEditorModal, type RowEditorProps } from "./RowEditor";

export interface ReportRowDisplay {
  shopeeOrderId: string;
  orderMeta: string;
  productName: string;
  categoryMeta: string;
  sku: string;
  kiotCode: string;
  amountDueLabel: string;
  amountPaidLabel: string;
  paymentMatchBadge: ReactNode;
  diffPercentLabel: string;
  paidAtLabel: string;
  status: string;
  deliveryResultLine: ReactNode;
  sendStatusBadge: ReactNode;
  sentAtLabel: string;
  cancelReceiptStatusBadge: ReactNode;
  cancelReceivedAtLabel: string;
  returnTrackingCode: string;
  defectRateLabel: string;
  note: string;
  cancelComplaintNote: string;
}

// Owns the "click row to open the Cập nhật đơn popup" interaction (design
// replaces the old per-row "Sửa" button with this) — the Luân check cell
// stops propagation so ticking it doesn't also open the popup.
export function ReportTableRow({
  luanCheck,
  display,
  editable,
}: {
  luanCheck: boolean;
  display: ReportRowDisplay;
  editable: RowEditorProps;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="row-clickable" onClick={() => setOpen(true)}>
        <td onClick={(e) => e.stopPropagation()}>
          <LuanCheckToggle orderId={editable.orderId} luanCheck={luanCheck} />
        </td>
        <td className="col-order">
          <div className="cell-stack">
            <strong>{display.shopeeOrderId}</strong>
            <span className="cell-sub">{display.orderMeta}</span>
          </div>
        </td>
        <td className="col-product cell-truncate" title={display.productName}>
          <div className="cell-stack">
            <span>{display.productName}</span>
            <span className="cell-sub">{display.categoryMeta}</span>
          </div>
        </td>
        <td className="col-sku">
          <div className="cell-stack">
            <span>{display.sku}</span>
            <span className="cell-sub">{display.kiotCode}</span>
          </div>
        </td>
        <td className="col-amount num">
          <div className="cell-stack" style={{ alignItems: "flex-end" }}>
            <span>{display.amountDueLabel}</span>
            <span className="cell-sub">{display.amountPaidLabel}</span>
          </div>
        </td>
        <td className="col-match">
          <div className="cell-stack">
            {display.paymentMatchBadge}
            <span className="cell-sub">{display.diffPercentLabel}</span>
          </div>
        </td>
        <td className="col-paidAt cell-muted">{display.paidAtLabel}</td>
        <td className="col-status cell-truncate" title={display.status}>
          <div className="cell-stack">
            <span>{display.status}</span>
            {display.deliveryResultLine}
          </div>
        </td>
        <td className="col-send">
          <div className="cell-stack">
            {display.sendStatusBadge}
            <span className="cell-sub">{display.sentAtLabel}</span>
          </div>
        </td>
        <td className="col-cancel">
          <div className="cell-stack">
            {display.cancelReceiptStatusBadge}
            <span className="cell-sub">{display.cancelReceivedAtLabel}</span>
            <span className="cell-sub">{display.returnTrackingCode}</span>
          </div>
        </td>
        <td className="col-defect num">{display.defectRateLabel}</td>
        <td className="col-note cell-truncate" title={`${display.note} · ${display.cancelComplaintNote}`}>
          <div className="cell-stack">
            <span>{display.note}</span>
            <span className="cell-sub">{display.cancelComplaintNote}</span>
          </div>
        </td>
      </tr>
      <RowEditorModal
        {...editable}
        open={open}
        onClose={() => setOpen(false)}
        shopeeOrderId={display.shopeeOrderId}
        productMeta={`${display.productName} · ${display.categoryMeta}`}
        amountSummary={`Cần thu ${display.amountDueLabel} · Drive ${display.amountPaidLabel}`}
        paymentMatchBadge={display.paymentMatchBadge}
      />
    </>
  );
}
