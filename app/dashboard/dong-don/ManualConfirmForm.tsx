"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function ManualConfirmForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [sentAt, setSentAt] = useState("");
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
    if (file) form.set("pdfFile", file);
    else form.set("pdfUrl", pdfUrl.trim());

    const response = await fetch("/api/zalo/manual-confirm", { method: "POST", body: form });
    const json = await response.json().catch(() => null);
    setSubmitting(false);

    if (response.ok) {
      const createdNote = json.createdCount > 0 ? `, tạo mới ${json.createdCount} đơn chưa sync` : "";
      setStatus(`Đã khớp ${json.matchedCount}/${json.orderIds.length} đơn trong file${createdNote}`);
      setPdfUrl("");
      setSentAt("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } else {
      setStatus(json?.error ?? `Lỗi (${response.status})`);
    }
  }

  return (
    <form onSubmit={submit} className="toolbar">
      <div className="field">
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
      <div className="field">
        <span className="field-label">Hoặc chọn file PDF</span>
        <input className="input" type="file" accept="application/pdf" ref={fileInputRef} />
      </div>
      <div className="field">
        <span className="field-label">Ngày, giờ gửi</span>
        <input className="input" type="datetime-local" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
      </div>
      <div className="field" style={{ flexDirection: "row", alignItems: "flex-end" }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
          {submitting ? "Đang xử lý..." : "Xác nhận"}
        </button>
      </div>
      {status && <span className="editor-status">{status}</span>}
    </form>
  );
}
