export interface ZaloMessage {
  msg_id: string;
  from_uid: string;
  from_name: string;
  is_self: boolean;
  content: string;
  ts: number;
}

export interface ZaloGroup {
  id: string;
  name: string;
}

function bridgeUrl(path: string): string {
  const base = process.env.ZALO_BRIDGE_URL;
  if (!base) throw new Error("ZALO_BRIDGE_URL is not configured");
  return `${base.replace(/\/$/, "")}${path}`;
}

function bridgeHeaders(): Record<string, string> {
  const secret = process.env.ZALO_BRIDGE_SECRET;
  if (!secret) throw new Error("ZALO_BRIDGE_SECRET is not configured");
  return { "x-webhook-secret": secret };
}

export async function fetchMessages(
  threadId: string,
  threadType: "user" | "group",
  sinceMsgId?: string | null
): Promise<ZaloMessage[]> {
  const params = new URLSearchParams({ thread_id: threadId, thread_type: threadType });
  if (sinceMsgId) params.set("since_msg_id", sinceMsgId);

  const response = await fetch(bridgeUrl(`/messages?${params.toString()}`), {
    headers: bridgeHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Zalo bridge /messages failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { messages?: ZaloMessage[] };
  return data.messages ?? [];
}

export async function searchGroups(query?: string): Promise<ZaloGroup[]> {
  const params = query ? `?q=${encodeURIComponent(query)}` : "";
  const response = await fetch(bridgeUrl(`/zalo/groups${params}`), {
    headers: bridgeHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Zalo bridge /zalo/groups failed: HTTP ${response.status}`);
  }
  return response.json();
}
