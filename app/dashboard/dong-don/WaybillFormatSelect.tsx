"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WAYBILL_FORMAT_OPTIONS } from "./waybillFormat";

// How the re-ordered PDF the bot posts into the Zalo group is laid out. Saved on the
// group's watch config as soon as it is changed, so it needs a group to be chosen.
export function WaybillFormatSelect({ initial, hasGroup }: { initial: number | null; hasGroup: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initial === null ? "same" : String(initial));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setSaving(true);
    setStatus("Đang lưu...");
    try {
      const response = await fetch("/api/zalo/waybill-format", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ perPage: next }),
      });
      const json = await response.json().catch(() => null);
      if (response.ok) {
        setStatus("Đã lưu — áp dụng cho PDF gửi vào nhóm từ lần sau");
        router.refresh();
      } else {
        setValue(previous);
        setStatus(json?.error ?? `Lỗi (${response.status})`);
      }
    } catch {
      setValue(previous);
      setStatus("Không kết nối được máy chủ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="field" style={{ marginTop: "var(--space-3)" }}>
      <span className="field-label">Định dạng PDF gửi vào nhóm</span>
      <select className="select" value={value} onChange={(e) => change(e.target.value)} disabled={!hasGroup || saving} aria-label="Định dạng PDF gửi vào nhóm">
        {WAYBILL_FORMAT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="editor-status">{!hasGroup ? "Chọn nhóm Zalo trước" : (status ?? "Cách xếp các phiếu trên mỗi trang của file PDF bot gửi lại nhóm")}</span>
    </div>
  );
}
