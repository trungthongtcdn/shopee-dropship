"use client";

import { useState, type FormEvent } from "react";

export function LoginForm({ next }: { next: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).catch(() => null);

    if (response?.ok) {
      // Hard navigation so the new cookie applies to a fresh server render.
      window.location.href = next;
      return;
    }

    const body = response ? await response.json().catch(() => null) : null;
    setError(body?.error ?? "Không kết nối được máy chủ");
    setSubmitting(false);
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <span className="field-label">Tên đăng nhập</span>
        <input
          className="input"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
          required
        />
      </div>
      <div className="field">
        <span className="field-label">Mật khẩu</span>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: "100%", marginTop: "var(--space-2)" }}>
        {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
    </form>
  );
}
