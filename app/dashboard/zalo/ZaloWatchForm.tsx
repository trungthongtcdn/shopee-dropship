"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Group {
  id: string;
  name: string;
}

export function ZaloWatchForm() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/zalo/groups?q=${encodeURIComponent(query)}`);
      const json = await response.json();
      if (!response.ok) {
        setStatus(json.error ?? `Tìm thất bại (${response.status})`);
        setGroups(null);
        return;
      }
      setGroups(json.groups);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Lỗi tìm nhóm");
    } finally {
      setSearching(false);
    }
  }

  async function select(group: Group) {
    setStatus(`Đang lưu "${group.name}"...`);
    const response = await fetch("/api/zalo/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: group.id, threadType: "group", threadName: group.name }),
    });
    if (response.ok) {
      setStatus(`Đã chọn theo dõi "${group.name}"`);
      setGroups(null);
      router.refresh();
    } else {
      const json = await response.json().catch(() => null);
      setStatus(json?.error ?? "Lỗi khi lưu");
    }
  }

  return (
    <div>
      <form onSubmit={search} style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <input
          className="input"
          type="text"
          placeholder="Tìm nhóm theo tên..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 240 }}
        />
        <button type="submit" className="btn btn-primary" disabled={searching}>
          {searching ? "Đang tìm..." : "Tìm nhóm"}
        </button>
      </form>

      {status && <p className="editor-status" style={{ marginTop: "var(--space-2)" }}>{status}</p>}

      {groups && groups.length > 0 ? (
        <ul className="list-plain" style={{ marginTop: "var(--space-3)" }}>
          {groups.map((group) => (
            <li key={group.id}>
              <a
                className="list-item-link"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  select(group);
                }}
              >
                <span>{group.name}</span>
                <span className="list-item-meta">chọn</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {groups && groups.length === 0 ? <p className="empty-state">Không tìm thấy nhóm nào.</p> : null}
    </div>
  );
}
