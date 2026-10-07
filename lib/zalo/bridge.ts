export interface ZaloMessage {
  msg_id: string;
  from_uid: string;
  from_name: string;
  is_self: boolean;
  content: string;
  // Observed in production as a numeric STRING (e.g. "1790326992116"), not
  // a number — the bridge just forwards whatever zca-js gives it uncoerced.
  // Any code doing arithmetic on this must coerce first (see tsToDate in
  // cancelReceiptPoller.ts).
  ts: number | string;
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

export async function sendGroupMessage(groupId: string, message: string): Promise<void> {
  const response = await fetch(bridgeUrl("/send-group-message"), {
    method: "POST",
    headers: { ...bridgeHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ group_id: groupId, message }),
  });
  if (!response.ok) {
    throw new Error(`Zalo bridge /send-group-message failed: HTTP ${response.status}`);
  }
}

// Posts a file (with an optional caption) to a group or 1-1 thread. The bridge
// takes it as base64 inside JSON — the Excel files this carries are tens of KB.
export async function sendFile(
  threadId: string,
  threadType: "user" | "group",
  fileName: string,
  data: Buffer,
  message?: string
): Promise<void> {
  const response = await fetch(bridgeUrl("/send-file"), {
    method: "POST",
    headers: { ...bridgeHeaders(), "content-type": "application/json" },
    body: JSON.stringify({
      thread_id: threadId,
      thread_type: threadType,
      filename: fileName,
      file_base64: data.toString("base64"),
      ...(message ? { message } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Zalo bridge /send-file failed: HTTP ${response.status}`);
  }
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
