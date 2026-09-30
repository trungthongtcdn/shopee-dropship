"use client";

import { useState } from "react";
import { ZaloWatchForm } from "./ZaloWatchForm";

// The Zalo group being watched almost never changes in practice, so it
// doesn't need to stay expanded on the page — collapse it to a one-line
// summary + a small button that opens the search/select UI in a popup.
export function ZaloGroupPicker({
  purpose,
  threadName,
  updatedAt,
  extra,
}: {
  purpose: string;
  threadName: string | null;
  updatedAt: string | null;
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="summary-bar">
      {threadName ? (
        <>
          <span className="stat-chip">
            Nhóm: <strong>{threadName}</strong>
          </span>
          {updatedAt ? <span className="stat-chip">Cập nhật lúc: {updatedAt}</span> : null}
        </>
      ) : (
        <span className="empty-state" style={{ margin: 0 }}>
          Chưa chọn nhóm nào.
        </span>
      )}
      {extra}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        Đổi nhóm
      </button>

      {open ? (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>Chọn nhóm Zalo</span>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Đóng">
                ×
              </button>
            </div>
            <ZaloWatchForm purpose={purpose} onSelected={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
