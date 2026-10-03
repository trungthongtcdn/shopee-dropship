"use client";

import { useRef, useState } from "react";

export function UploadForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function setFile(file: File | null) {
    if (!file || !fileInputRef.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInputRef.current.files = transfer.files;
    setFileName(file.name);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/reconcile/upload", { method: "POST", body: formData });

    // The route always answers with JSON, but an infrastructure-level failure
    // (proxy error page, request body size limit) can return HTML or nothing at
    // all. Do not let that surface as an unhandled parse rejection.
    let json: { batchId?: number; resultCount?: number; error?: string } | null = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    if (!response.ok) {
      setStatus(json?.error ?? `Upload failed (${response.status})`);
      return;
    }

    if (!json) {
      setStatus("Upload finished but the response could not be read");
      return;
    }

    setStatus(`Batch ${json.batchId} done, ${json.resultCount} results`);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <label
        className={`drop-zone${dragActive ? " drag-active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          setFile(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          name="file"
          accept=".xlsx,.xls"
          required
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
        <span>{fileName ?? "Kéo thả file Excel vào đây, hoặc bấm để chọn file"}</span>
        <span className="cell-sub">.xlsx, .xls</span>
      </label>
      <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-2)" }}>
        <button type="submit" className="btn btn-primary">
          Upload
        </button>
        {status && <span className="editor-status">{status}</span>}
      </div>
    </form>
  );
}
