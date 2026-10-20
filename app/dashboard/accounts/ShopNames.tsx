"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export interface ShopNameRow {
  id: number;
  slug: string;
  name: string;
}

const MAX_LENGTH = 40;

function ShopNameForm({ shop }: { shop: ShopNameRow }) {
  const router = useRouter();
  const [name, setName] = useState(shop.name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const response = await fetch(`/api/shops/${shop.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    setSaving(false);

    if (response?.ok) {
      const data = await response.json().catch(() => null);
      setName(data?.shop?.name ?? name);
      setMessage({ kind: "ok", text: "Đã lưu" });
      router.refresh();
      return;
    }
    const data = response ? await response.json().catch(() => null) : null;
    setMessage({ kind: "error", text: data?.error ?? "Không kết nối được máy chủ" });
  }

  return (
    <form onSubmit={submit}>
      <div className="shop-name-row">
        <input
          className="input"
          type="text"
          value={name}
          maxLength={MAX_LENGTH}
          onChange={(e) => {
            setName(e.target.value);
            setMessage(null);
          }}
          aria-label={`Tên ${shop.slug.replace("_", " ")}`}
          required
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving || name.trim() === shop.name}>
          {saving ? "Đang lưu…" : "Lưu"}
        </button>
        {message ? (
          <span className={message.kind === "error" ? "form-error" : "cell-muted"} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}

// Each shop's name as it shows in the header's shop switcher. Shops themselves are added
// by whoever runs the site, not from here.
export function ShopNames({ shops }: { shops: ShopNameRow[] }) {
  return (
    <section className="shop-names">
      <h2>Tên shop</h2>
      <p className="cell-muted" style={{ margin: 0 }}>
        Tên hiện ở ô chọn shop trên đầu trang. Tối đa {MAX_LENGTH} ký tự, không trùng nhau.
      </p>
      {shops.map((shop) => (
        <ShopNameForm key={shop.id} shop={shop} />
      ))}
    </section>
  );
}
