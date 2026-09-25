import { describe, it, expect } from "vitest";
import { planFromMessages, type PollState } from "@/lib/zalo/poller";
import type { ZaloMessage } from "@/lib/zalo/bridge";

const EMPTY_STATE: PollState = { pendingPdfUrl: null, pendingPdfMsgId: null };

function msg(overrides: Partial<ZaloMessage> & { msg_id: string }): ZaloMessage {
  return {
    from_uid: "u1",
    from_name: "Đối tác",
    is_self: false,
    content: "",
    ts: 1,
    ...overrides,
  };
}

describe("planFromMessages", () => {
  it("produces a confirmation when a pdf link is followed by the confirm phrase", () => {
    const messages = [
      msg({ msg_id: "1", content: "link: https://example.com/waybill.pdf" }),
      msg({ msg_id: "2", from_name: "Nhân viên A", content: "Đã in 3 đơn" }),
    ];
    const result = planFromMessages(messages, EMPTY_STATE);

    expect(result.confirmations).toEqual([
      { pdfUrl: "https://example.com/waybill.pdf", confirmedByName: "Nhân viên A", confirmedAt: 1 },
    ]);
    expect(result.state).toEqual(EMPTY_STATE);
    expect(result.lastMsgId).toBe("2");
  });

  it("ignores a confirm phrase with no pending pdf link", () => {
    const messages = [msg({ msg_id: "1", content: "Đã in 3 đơn" })];
    const result = planFromMessages(messages, EMPTY_STATE);

    expect(result.confirmations).toEqual([]);
    expect(result.state).toEqual(EMPTY_STATE);
  });

  it("processes is_self messages too (the bridge is read-only, and the operator's own account is usually the one logged in)", () => {
    const messages = [
      msg({ msg_id: "1", is_self: true, content: "link: https://example.com/waybill.pdf" }),
      msg({ msg_id: "2", is_self: true, from_name: "Luân", content: "Đã in 3 đơn" }),
    ];
    const result = planFromMessages(messages, EMPTY_STATE);

    expect(result.confirmations).toEqual([
      { pdfUrl: "https://example.com/waybill.pdf", confirmedByName: "Luân", confirmedAt: 1 },
    ]);
    expect(result.state.pendingPdfUrl).toBeNull();
  });

  it("a newer pdf link replaces an older unconfirmed one", () => {
    const messages = [
      msg({ msg_id: "1", content: "https://example.com/old.pdf" }),
      msg({ msg_id: "2", content: "https://example.com/new.pdf" }),
      msg({ msg_id: "3", content: "Đã in 3 đơn" }),
    ];
    const result = planFromMessages(messages, EMPTY_STATE);

    expect(result.confirmations).toEqual([
      { pdfUrl: "https://example.com/new.pdf", confirmedByName: "Đối tác", confirmedAt: 1 },
    ]);
  });

  it("carries forward a pending link from a previous poll cycle (initialState)", () => {
    const initialState: PollState = { pendingPdfUrl: "https://example.com/waybill.pdf", pendingPdfMsgId: "0" };
    const messages = [msg({ msg_id: "1", content: "Đã in 3 đơn" })];
    const result = planFromMessages(messages, initialState);

    expect(result.confirmations).toHaveLength(1);
    expect(result.confirmations[0].pdfUrl).toBe("https://example.com/waybill.pdf");
  });

  it("handles two independent link+confirm cycles in one batch", () => {
    const messages = [
      msg({ msg_id: "1", content: "https://example.com/a.pdf" }),
      msg({ msg_id: "2", content: "Đã in 3 đơn" }),
      msg({ msg_id: "3", content: "https://example.com/b.pdf" }),
      msg({ msg_id: "4", content: "Đã in 3 đơn" }),
    ];
    const result = planFromMessages(messages, EMPTY_STATE);

    expect(result.confirmations.map((c) => c.pdfUrl)).toEqual(["https://example.com/a.pdf", "https://example.com/b.pdf"]);
    expect(result.state).toEqual(EMPTY_STATE);
  });

  it("returns lastMsgId from the final message even when nothing else happens", () => {
    const messages = [msg({ msg_id: "1", content: "chào buổi sáng" }), msg({ msg_id: "2", content: "trưa nay ăn gì" })];
    const result = planFromMessages(messages, EMPTY_STATE);

    expect(result.lastMsgId).toBe("2");
    expect(result.confirmations).toEqual([]);
  });
});
