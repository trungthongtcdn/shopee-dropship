"use client";

import { useEffect, useRef, useState } from "react";

// Multi-select filter rendered as a closed-by-default dropdown instead of a
// wall of pills — the checkboxes inside are real form inputs (name/value),
// so the surrounding <form method="get"> still submits them as repeated
// query params with zero extra JS; this component only adds the open/close
// UX, the live "(n)" count in the summary label, and a "Tất cả" box that
// ticks / clears every option at once.
export function FilterDropdown({
  name,
  label,
  options,
  selected,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
}) {
  const [checked, setChecked] = useState<string[]>(() => selected.filter((value) => options.some((option) => option.value === value)));
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const allChecked = options.length > 0 && checked.length === options.length;

  function toggle(value: string, on: boolean) {
    setChecked((current) => (on ? [...current, value] : current.filter((v) => v !== value)));
  }

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
    <details ref={detailsRef} className="filter-dropdown">
      <summary className="filter-dropdown-summary" aria-label={label}>
        {checked.length > 0 && !allChecked ? `${checked.length} đã chọn` : "Tất cả"}
      </summary>
      <div className="filter-dropdown-menu">
        {options.length === 0 ? (
          <p className="filter-dropdown-empty">Không có lựa chọn</p>
        ) : (
          <>
            <label className="filter-dropdown-item filter-dropdown-all">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => setChecked(e.target.checked ? options.map((option) => option.value) : [])}
              />
              Tất cả
            </label>
            {options.map((option) => (
              <label key={option.value} className="filter-dropdown-item">
                <input
                  type="checkbox"
                  name={name}
                  value={option.value}
                  checked={checked.includes(option.value)}
                  onChange={(e) => toggle(option.value, e.target.checked)}
                />
                {option.label}
              </label>
            ))}
          </>
        )}
      </div>
    </details>
  );
}
