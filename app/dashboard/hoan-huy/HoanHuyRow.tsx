"use client";

import { useState } from "react";

export interface HoanHuySummary {
  id: number;
  typeLabel: string;
  typeClassName: string;
  shopeeOrderId: string;
  trackingCode: string;
  productName: string;
  quantityMeta: string;
  returnTrackingCode: string;
  returnMeta: string;
  refundAmountLabel: string;
  complaintReason: string;
  complaintStatus: string;
  respondByLabel: string;
  respondByClassName: string;
}

export interface HoanHuyDetails {
  returnReason: string;
  buyerNote: string;
  shopeeNote: string;
  supplierNote: string;
  complaintAtLabel: string;
  cancelledAtLabel: string;
}

// "Nút mở rộng" from the design — the low-traffic free-text fields (return
// reason, 3 separate note fields, 2 more dates) move into a collapsed
// second row instead of permanent columns, opened per-row on demand.
export function HoanHuyRow({ summary, details }: { summary: HoanHuySummary; details: HoanHuyDetails }) {
  const [expanded, setExpanded] = useState(false);

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
        <td>
          <div className="cell-stack">
            <span>{summary.returnTrackingCode}</span>
            <span className="cell-sub">{summary.returnMeta}</span>
          </div>
        </td>
        <td className="num">{summary.refundAmountLabel}</td>
        <td className="cell-truncate" title={summary.complaintReason}>
          <div className="cell-stack">
            <span>{summary.complaintReason}</span>
            <span className="cell-sub">{summary.complaintStatus}</span>
          </div>
        </td>
        <td>
          <span className={summary.respondByClassName}>{summary.respondByLabel}</span>
        </td>
        <td>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Thu gọn" : "Chi tiết"}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={8}>
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
                <strong className="cell-sub">Ghi chú NCC:</strong> {details.supplierNote}
              </span>
              <span>
                <strong className="cell-sub">Thời gian khiếu nại:</strong> {details.complaintAtLabel}
              </span>
              <span>
                <strong className="cell-sub">Ngày huỷ thành công:</strong> {details.cancelledAtLabel}
              </span>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
