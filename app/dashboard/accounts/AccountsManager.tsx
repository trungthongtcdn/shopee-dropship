"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export interface AccountRowData {
  id: number;
  username: string;
  createdLabel: string;
}

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; account: AccountRowData }
  | { kind: "delete"; account: AccountRowData }
  | null;

export function AccountsManager({ accounts, currentUserId }: { accounts: AccountRowData[]; currentUserId: number | null }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function open(next: Exclude<Dialog, null>) {
    setUsername(next.kind === "edit" ? next.account.username : "");
    setPassword("");
    setError(null);
    setDialog(next);
  }

  function close() {
    if (!saving) setDialog(null);
  }

  async function send(method: string, url: string, body?: unknown) {
    setSaving(true);
    setError(null);
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    setSaving(false);

    if (response?.ok) {
      setDialog(null);
      router.refresh();
      return;
    }
    const data = response ? await response.json().catch(() => null) : null;
    setError(data?.error ?? "Không kết nối được máy chủ");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (dialog?.kind === "create") {
      void send("POST", "/api/accounts", { username, password });
    } else if (dialog?.kind === "edit") {
      void send("PATCH", `/api/accounts/${dialog.account.id}`, { username, password });
    }
  }

  return (
    <>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <p className="cell-muted" style={{ margin: 0 }}>
          {accounts.length} tài khoản
        </p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => open({ kind: "create" })}>
          Thêm tài khoản
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tên đăng nhập</th>
              <th>Ngày tạo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const isMe = account.id === currentUserId;
              return (
                <tr key={account.id}>
                  <td>
                    <strong>{account.username}</strong> {isMe ? <span className="badge badge-info">bạn</span> : null}
                  </td>
                  <td className="cell-muted">{account.createdLabel}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => open({ kind: "edit", account })}>
                      Sửa
                    </button>{" "}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={isMe}
                      title={isMe ? "Không thể xoá tài khoản đang đăng nhập" : undefined}
                      onClick={() => open({ kind: "delete", account })}
                    >
                      Xoá
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog ? (
        <div className="modal-overlay" onClick={close}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            {dialog.kind === "delete" ? (
              <>
                <div className="modal-header">
                  <span>Xoá tài khoản</span>
                  <button type="button" className="modal-close" onClick={close} aria-label="Đóng">
                    ×
                  </button>
                </div>
                <p style={{ marginTop: 0 }}>
                  Xoá tài khoản <strong>{dialog.account.username}</strong>? Tài khoản này sẽ không đăng nhập được nữa.
                </p>
                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={saving}
                    onClick={() => void send("DELETE", `/api/accounts/${dialog.account.id}`)}
                  >
                    {saving ? "Đang xoá…" : "Xoá"}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={close}>
                    Huỷ
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={submit}>
                <div className="modal-header">
                  <span>{dialog.kind === "create" ? "Thêm tài khoản" : "Sửa tài khoản"}</span>
                  <button type="button" className="modal-close" onClick={close} aria-label="Đóng">
                    ×
                  </button>
                </div>
                <div className="field">
                  <span className="field-label">Tên đăng nhập</span>
                  <input
                    className="input"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoFocus
                    required
                  />
                </div>
                <div className="field">
                  <span className="field-label">{dialog.kind === "create" ? "Mật khẩu" : "Mật khẩu mới"}</span>
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder={dialog.kind === "edit" ? "Để trống = giữ mật khẩu cũ" : undefined}
                    required={dialog.kind === "create"}
                  />
                </div>
                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="modal-actions">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                    {saving ? "Đang lưu…" : "Lưu"}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={close}>
                    Huỷ
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
