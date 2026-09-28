"use client";

import { useEffect, useRef, useState } from "react";

// Multi-select filter rendered as a closed-by-default dropdown instead of a
// wall of pills — the checkboxes inside are real form inputs (name/value/
// defaultChecked), so the surrounding <form method="get"> still submits
// them as repeated query params with zero extra JS; this component only
// adds the open/close UX and the live "(n)" count in the summary label.
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
  const [count, setCount] = useState(selected.length);
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
    <details ref={detailsRef} className="filter-dropdown">
      <summary className="filter-dropdown-summary">
        {label}
        {count > 0 ? ` (${count})` : ""}
      </summary>
      <div className="filter-dropdown-menu">
        {options.length === 0 ? (
          <p className="filter-dropdown-empty">Không có lựa chọn</p>
        ) : (
          options.map((option) => (
            <label key={option.value} className="filter-dropdown-item">
              <input
                type="checkbox"
                name={name}
                value={option.value}
                defaultChecked={selected.includes(option.value)}
                onChange={(e) => setCount((c) => (e.target.checked ? c + 1 : c - 1))}
              />
              {option.label}
            </label>
          ))
        )}
      </div>
    </details>
  );
}
