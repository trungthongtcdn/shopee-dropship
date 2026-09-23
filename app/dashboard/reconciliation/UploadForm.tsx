"use client";

import { useState } from "react";

export function UploadForm() {
  const [status, setStatus] = useState<string | null>(null);

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
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
      <input className="input" type="file" name="file" accept=".xlsx,.xls" required />
      <button type="submit" className="btn btn-primary">
        Upload
      </button>
      {status && <span className="editor-status">{status}</span>}
    </form>
  );
}
