"use client";

import { useState } from "react";

export function UploadForm() {
  const [status, setStatus] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/reconcile/upload", { method: "POST", body: formData });
    const json = await response.json();
    setStatus(response.ok ? `Batch ${json.batchId} done, ${json.resultCount} results` : json.error);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="file" name="file" accept=".xlsx,.xls" required />
      <button type="submit">Upload</button>
      {status && <p>{status}</p>}
    </form>
  );
}
