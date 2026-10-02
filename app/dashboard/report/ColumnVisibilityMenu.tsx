"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "report.hiddenColumns";

// Keys here must match the .col-* class each <td>/<th> carries and the
// html[data-hide-col~="..."] rules in globals.css. "Luân check" and "Đơn
// hàng" aren't listed — those two stay always visible as the row's anchor
// columns, per the design.
const COLUMN_OPTIONS = [
  { key: "product", label: "Sản phẩm" },
  { key: "sku", label: "SKU · Mã Kiot" },
  { key: "amount", label: "Cần thu / Đã TT" },
  { key: "match", label: "Đối soát TT" },
  { key: "paidAt", label: "Ngày đối soát" },
  { key: "status", label: "Trạng thái đơn" },
  { key: "send", label: "Đóng đơn" },
  { key: "cancel", label: "Nhận huỷ · VĐ trả hàng" },
  { key: "defect", label: "% hỏng" },
  { key: "note", label: "Ghi chú · Khiếu nại huỷ" },
] as const;

export function ColumnVisibilityMenu() {
  const [hidden, setHidden] = useState<string[]>([]);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  // Load the saved preference after mount only — this is a pure client-side
  // convenience (not server data), so reading localStorage during the
  // initial server-rendered pass isn't possible anyway.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) setHidden(parsed);
    } catch {
      // Ignore malformed storage value — fall back to "show everything".
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.hideCol = hidden.join(" ");
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
  }, [hidden]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        detailsRef.current.open = false;
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  function toggle(key: string) {
    setHidden((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  return (
    <details ref={detailsRef} className="filter-dropdown" style={{ width: 190 }}>
      <summary className="filter-dropdown-summary">Cột hiển thị</summary>
      <div className="filter-dropdown-menu">
        {COLUMN_OPTIONS.map((col) => (
          <label key={col.key} className="filter-dropdown-item">
            <input type="checkbox" checked={!hidden.includes(col.key)} onChange={() => toggle(col.key)} />
            {col.label}
          </label>
        ))}
      </div>
    </details>
  );
}
