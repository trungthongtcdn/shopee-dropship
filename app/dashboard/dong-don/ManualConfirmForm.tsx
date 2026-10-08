"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WAYBILL_FORMAT_OPTIONS } from "./waybillFormat";

export function ManualConfirmForm({ defaultPerPage = null }: { defaultPerPage?: number | null }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"link" | "file">("link");
  const [pdfUrl, setPdfUrl] = useState("");
  const [sentAt, setSentAt] = useState("");
  // Layout of the re-ordered PDF kept for the "Xem file" button; starts at what the Zalo group gets.
  const [perPage, setPerPage] = useState(defaultPerPage === null ? "same" : String(defaultPerPage));
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sentAt) {
      setStatus("Cần chọn ngày, giờ");
      return;
    }

    const file = fileInputRef.current?.files?.[0] ?? null;
    if (!file && !pdfUrl.trim()) {
      setStatus("Cần nhập link PDF hoặc chọn file");
      return;
    }

    setSubmitting(true);
    setStatus("Đang xử lý...");

    const form = new FormData();
    form.set("sentAt", new Date(sentAt).toISOString());
    form.set("perPage", perPage);
    if (file) form.set("pdfFile", file);
    else form.set("pdfUrl", pdfUrl.trim());

    const response = await fetch("/api/zalo/manual-confirm", { method: "POST", body: form });
    const json = await response.json().catch(() => null);
    setSubmitting(false);

    if (response.ok) {
      const createdNote = json.createdCount > 0 ? `, tạo mới ${json.createdCount} đơn chưa sync` : "";
      const excelNote = json.hasExcel
        ? `. Đã tạo file excel gom nhóm${json.hasSortedPdf ? " và PDF đã xếp lại" : ""} — bấm nút ở lịch sử bên dưới để xem`
        : "";
      setStatus(`Đã khớp ${json.matchedCount}/${json.orderIds.length} đơn trong file${createdNote}${excelNote}`);
      setPdfUrl("");
      setSentAt("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } else {
      setStatus(json?.error ?? `Lỗi (${response.status})`);
    }
  }

  return (
    <form onSubmit={submit} className="toolbar" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className={`filter-pill${tab === "link" ? " active" : ""}`}
          onClick={() => setTab("link")}
        >
          Dán link
        </button>
        <button
          type="button"
          className={`filter-pill${tab === "file" ? " active" : ""}`}
          onClick={() => setTab("file")}
        >
          Tải file PDF
        </button>
      </div>

      {tab === "link" ? (
        <div className="field" key="link">
          <span className="field-label">Link PDF</span>
          <input
            className="input"
            type="text"
            placeholder="https://..."
            value={pdfUrl}
            onChange={(e) => setPdfUrl(e.target.value)}
            style={{ minWidth: 260 }}
          />
        </div>
      ) : (
        <div className="field" key="file">
          <span className="field-label">Chọn file PDF</span>
          <input className="input" type="file" accept="application/pdf" ref={fileInputRef} />
        </div>
      )}

      <div className="field">
        <span className="field-label">Định dạng PDF xuất ra</span>
        <select className="select" value={perPage} onChange={(e) => setPerPage(e.target.value)} aria-label="Định dạng PDF xuất ra">
          {WAYBILL_FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="field-label">Ngày, giờ gửi</span>
        <input className="input" type="datetime-local" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
      </div>
      <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-2)" }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
          {submitting ? "Đang xử lý..." : "Xác nhận"}
        </button>
        {status && <span className="editor-status">{status}</span>}
      </div>
    </form>
  );
}
