"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Wraps several date-range field groups behind one "Khoảng ngày"-style
// dropdown trigger, same closed-by-default/click-outside UX as
// FilterDropdown — but the content is arbitrary children (date inputs)
// instead of a checkbox list, since each range here is its own pair of
// native <input type="date"> form fields that submit with the surrounding
// <form method="get"> exactly as before.
export function DateRangeDropdown({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        detailsRef.current.open = false;
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  return (
    <details ref={detailsRef} className="filter-dropdown" style={{ width: 230 }}>
      <summary className="filter-dropdown-summary" aria-label={label}>
        {count > 0 ? `${label} (${count})` : label}
      </summary>
      <div className="filter-dropdown-menu" style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
        {children}
      </div>
    </details>
  );
}
