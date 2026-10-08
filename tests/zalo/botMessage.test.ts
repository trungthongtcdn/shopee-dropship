import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { BOT_MESSAGE_PREFIX, isBotMessage, markBotMessage } from "@/lib/zalo/botMessage";
import { sendFile, sendGroupMessage } from "@/lib/zalo/bridge";
import { planCancelReceiptMessages } from "@/lib/zalo/cancelReceiptPoller";
import { planFromMessages } from "@/lib/zalo/poller";
import type { ZaloMessage } from "@/lib/zalo/bridge";

describe("markBotMessage / isBotMessage", () => {
  it("tags a text, and recognises it again", () => {
    const tagged = markBotMessage("⚠️ 1 đơn vượt ngưỡng cảnh báo\n- 260930DYT4YHF7 (THHT, 5 ngày)");
    expect(tagged.startsWith(BOT_MESSAGE_PREFIX)).toBe(true);
    expect(isBotMessage(tagged)).toBe(true);
  });

  it("never tags twice", () => {
    const once = markBotMessage("xin chào");
    expect(markBotMessage(once)).toBe(once);
  });

  it("tags a text that only looks like an old untagged post (the tag is the rule, the old shapes a fallback)", () => {
    const text = "⚠️ 2 đơn vượt ngưỡng cảnh báo (chưa cập nhật trạng thái nhận huỷ/khiếu nại):\n- A (THHT, 5 ngày)";
    expect(markBotMessage(text)).toBe(`${BOT_MESSAGE_PREFIX}${text}`);
  });

  it.each([
    "⚠️ 1 đơn vượt ngưỡng cảnh báo (chưa cập nhật trạng thái nhận huỷ/khiếu nại):\n- 260930DYT4YHF7 (THHT, 5 ngày)",
    "⚠ 3 đơn vượt ngưỡng cảnh báo (chưa cập nhật …)",
    "Đây là danh sách đơn đã gom các đơn giống nhau đứng gần nhau",
    "Đây là file PDF phiếu gửi hàng đã sắp xếp lại theo đúng thứ tự trong file Excel",
    "  [Bot] đã in xong",
  ])("recognises our own post: %s", (content) => {
    expect(isBotMessage(content)).toBe(true);
  });

  it.each([
    "260930DYT4YHF7 đã nhận huỷ",
    "SPXVN06477529935A xO",
    "Đã in 50 đơn",
    "https://cdn.example.com/awb.pdf",
    "chị ơi cảnh báo [Bot] gì đó",
    "",
  ])("leaves a person's message alone: %s", (content) => {
    expect(isBotMessage(content)).toBe(false);
  });
});

describe("what the app sends", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.ZALO_BRIDGE_URL = "http://bridge.test";
    process.env.ZALO_BRIDGE_SECRET = "s3cret";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

  it("tags a group message", async () => {
    await sendGroupMessage("g1", "⚠️ 1 đơn vượt ngưỡng cảnh báo\n- 260930DYT4YHF7");
    const body = sentBody();
    expect(body.group_id).toBe("g1");
    expect(isBotMessage(body.message)).toBe(true);
    expect(body.message.startsWith(BOT_MESSAGE_PREFIX)).toBe(true);
    expect(body.message).toContain("260930DYT4YHF7");
  });

  it("tags a file's caption", async () => {
    await sendFile("g1", "group", "list.xlsx", Buffer.from("x"), "Đây là danh sách đơn");
    expect(sentBody().message).toBe(`${BOT_MESSAGE_PREFIX}Đây là danh sách đơn`);
  });

  it("tags a file sent without a caption too (the file name stands in)", async () => {
    await sendFile("g1", "group", "list.xlsx", Buffer.from("x"));
    expect(sentBody().message).toBe(`${BOT_MESSAGE_PREFIX}list.xlsx`);
  });
});

// The loop this exists to stop: the app posts, the bridge hands the post back as one of
// the operator's own messages (is_self), and a poller acts on it.
describe("the pollers and the app's own posts", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.ZALO_BRIDGE_URL = "http://bridge.test";
    process.env.ZALO_BRIDGE_SECRET = "s3cret";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const echo = (msg_id: string, content: string, is_self = true): ZaloMessage => ({
    msg_id,
    from_uid: "bridge-account",
    from_name: "Luân Nguyễn",
    is_self,
    content,
    ts: "1790326992116",
  });
  const posted = async (text: string) => {
    fetchMock.mockClear();
    await sendGroupMessage("g1", text);
    return JSON.parse(fetchMock.mock.calls[0][1].body as string).message as string;
  };

  it("a warning listing order ids is not a cancel-receipt confirmation", async () => {
    const warning = await posted("⚠️ 1 đơn vượt ngưỡng cảnh báo (chưa cập nhật trạng thái nhận huỷ/khiếu nại):\n- 260930DYT4YHF7 (THHT, 5 ngày)");
    const plan = planCancelReceiptMessages([echo("1", warning)]);
    expect(plan.matches).toEqual([]);
    expect(plan.lastMsgId).toBe("1"); // still moves past it
  });

  it("the same warning as it was posted before tagging is skipped too", () => {
    const old = "⚠️ 1 đơn vượt ngưỡng cảnh báo (chưa cập nhật trạng thái nhận huỷ/khiếu nại):\n- 260930DYT4YHF7 (THHT, 5 ngày)";
    expect(planCancelReceiptMessages([echo("1", old)]).matches).toEqual([]);
  });

  it("a person typing the same order id from the same account still confirms it", () => {
    const plan = planCancelReceiptMessages([echo("1", "260930DYT4YHF7 đã nhận huỷ")]);
    expect(plan.matches.map((m) => m.codes)).toEqual([["260930DYT4YHF7"]]);
  });

  it("a caption that happens to say 'đã in' does not confirm a waybill", async () => {
    const caption = await posted("Danh sách đơn đã in xong, đứng gần nhau");
    const plan = planFromMessages(
      [echo("1", "https://cdn.example.com/awb.pdf", false), echo("2", caption)],
      { pendingPdfUrl: null, pendingPdfMsgId: null }
    );
    expect(plan.confirmations).toEqual([]);
    expect(plan.state.pendingPdfUrl).toBe("https://cdn.example.com/awb.pdf");
  });

  it("a post carrying a PDF link is not taken for a new waybill", async () => {
    const post = await posted("File đây https://files.example.com/sorted.pdf");
    const plan = planFromMessages([echo("1", post)], { pendingPdfUrl: null, pendingPdfMsgId: null });
    expect(plan.pdfMessages).toEqual([]);
    expect(plan.state.pendingPdfUrl).toBeNull();
  });
});
