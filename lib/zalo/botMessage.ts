// Everything this app posts into a Zalo group goes out through the operator's own
// account (the one the bridge is logged into), and the bridge listens with
// selfListen on — so the app's own posts come straight back from /messages with
// is_self true, exactly like the operator's own typing. is_self therefore can't
// tell the two apart, and the pollers must not act on the app's posts: a warning
// that lists order ids would otherwise be read as "staff confirmed these orders
// were received" (it was, once: the overdue warning for order 260930DYT4YHF7 marked
// that very order received).
//
// So every outgoing text starts with a visible tag, and the pollers skip any message
// that does. A plain-ASCII tag on purpose: it has to survive Zalo untouched.

export const BOT_MESSAGE_PREFIX = "[Bot] ";

const hasTag = (text: string) => text.trimStart().startsWith(BOT_MESSAGE_PREFIX.trim());

export function markBotMessage(text: string): string {
  return hasTag(text) ? text : `${BOT_MESSAGE_PREFIX}${text}`;
}

// What the app posted before messages were tagged; a few may still sit in the bridge's
// buffer around a deploy.
const UNTAGGED_BOT_MESSAGES = [
  /^⚠️?\s*\d+ đơn vượt ngưỡng cảnh báo/,
  /^Đây là danh sách đơn đã gom các đơn giống nhau/,
  /^Đây là file PDF phiếu gửi hàng đã sắp xếp lại/,
];

export function isBotMessage(content: string): boolean {
  return hasTag(content) || UNTAGGED_BOT_MESSAGES.some((pattern) => pattern.test(content.trimStart()));
}
