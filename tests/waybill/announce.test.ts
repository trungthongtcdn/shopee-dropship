import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { makePdf } from "./pdfFixture";

const sendFile = vi.fn(async () => {});
vi.mock("@/lib/zalo/bridge", () => ({ sendFile: (...args: unknown[]) => (sendFile as (...a: unknown[]) => Promise<void>)(...args) }));
// The price sheet is not fetched here: the pages below already carry the Kiot lines it would give.
vi.mock("@/lib/kiot", () => ({
  kiotCatalog: () => ({ mapPages: async (pages: unknown[]) => ({ pages, notices: [], khoOptions: ["khoLuan", "khouni"] }) }),
}));

import { announceWaybill, holdMessage, sendDraftFiles } from "@/lib/waybill/announce";
import { createDraft, loadDraft, loadDraftPdf, saveOverrides } from "@/lib/waybill/drafts";
import type { WaybillPage } from "@/lib/waybill/items";

const AT = new Date("2026-10-07T03:15:00Z");
const thread = { id: "G1", type: "group" as const };

function page(pageIndex: number, orderId: string, khos: string[]): WaybillPage {
  return {
    pageIndex,
    shopeeOrderId: orderId,
    trackingCode: `SPXVN_${orderId}`,
    declaredTotalQuantity: 1,
    items: [{ name: orderId, variant: "V", quantity: 1, sku: orderId, kiotLines: khos.map((khoGiao) => ({ sku: orderId, quantity: 1, kiotCode: `K_${orderId}`, khoGiao })) }],
  };
}
const CLEAR = [page(0, "O1", ["khoLuan"]), page(1, "O2", ["khouni"])];
const NEEDS_HAND = [page(0, "O1", ["khoLuan"]), page(1, "O2", ["khoLuan", "khouni"])];

const names = () => (sendFile.mock.calls as unknown as string[][]).map((call) => call[2]);

describe("announceWaybill", () => {
  const tell = vi.fn(async () => {});
  const savedBase = process.env.PUBLIC_BASE_URL;

  beforeEach(async () => {
    sendFile.mockReset();
    sendFile.mockResolvedValue(undefined);
    tell.mockReset();
    process.env.PUBLIC_BASE_URL = "https://example.test";
    await prisma.waybillDraft.deleteMany();
  });
  afterEach(() => {
    if (savedBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = savedBase;
  });

  const announce = async (pages: WaybillPage[], extra: Partial<Parameters<typeof announceWaybill>[0]> = {}) =>
    announceWaybill({ thread, pdfUrl: "https://cdn/a.pdf", pages, pdf: await makePdf(pages.length), labelCount: pages.length, at: AT, tell, ...extra });

  it("posts the overall Excel and PDF and each kho's own files when every order has its kho, the link under the Excel", async () => {
    const result = await announce(CLEAR);

    expect(result).toMatchObject({ held: false });
    expect(names()).toEqual([
      "Furni_10h0710_2 đơn_Đã gom.xlsx",
      "Furni_10h0710_2 đơn_Đã gom.pdf",
      "Furni_10h0710_1 đơn_Đã gom_khoLuan.xlsx",
      "Furni_10h0710_1 đơn_Đã gom_khoLuan.pdf",
      "Furni_10h0710_1 đơn_Đã gom_khouni.xlsx",
      "Furni_10h0710_1 đơn_Đã gom_khouni.pdf",
    ]);
    const caption = (sendFile.mock.calls[0] as unknown as string[])[4];
    expect(caption).toContain(`https://example.test/dashboard/dong-don/phieu/${result.draftId}?shop=shop_1`);
    expect(tell).not.toHaveBeenCalled();
    expect((await loadDraft(result.draftId!))?.sentAt).toBeInstanceOf(Date);
  });

  it("holds the files back and posts only the link when some order's Kiot codes are in different kho", async () => {
    const result = await announce(NEEDS_HAND);

    expect(result.held).toBe(true);
    expect(sendFile).not.toHaveBeenCalled();
    expect(tell).toHaveBeenCalledTimes(1);
    expect(tell).toHaveBeenCalledWith(`draft:${result.draftId}`, holdMessage(1, `https://example.test/dashboard/dong-don/phieu/${result.draftId}?shop=shop_1`));
    expect((await loadDraft(result.draftId!))?.sentAt).toBeNull();
  });

  it("keeps the PDF and the orders in the draft, ready for the page", async () => {
    const result = await announce(NEEDS_HAND);
    const draft = (await loadDraft(result.draftId!))!;
    expect(draft.pages.map((p) => p.shopeeOrderId)).toEqual(["O1", "O2"]);
    expect(draft.khoOptions).toEqual(["khoLuan", "khouni"]);
    expect((await loadDraftPdf(draft.id))!.length).toBeGreaterThan(100);
  });

  it("does not hold anything back when the site's address isn't set (nobody could open the link) or the thread is not a group", async () => {
    delete process.env.PUBLIC_BASE_URL;
    expect((await announce(NEEDS_HAND)).held).toBe(false);
    expect(names().length).toBeGreaterThan(0);

    sendFile.mockClear();
    process.env.PUBLIC_BASE_URL = "https://example.test";
    expect((await announce(NEEDS_HAND, { pdfUrl: "https://cdn/b.pdf", thread: { id: "U1", type: "user" } })).held).toBe(false);
    expect(names().length).toBeGreaterThan(0);
    expect(tell).not.toHaveBeenCalled();
  });

  it("does not hold anything back for orders the sheet merely knows nothing of", async () => {
    const unknown: WaybillPage = { pageIndex: 0, shopeeOrderId: "U", trackingCode: "SPXVN_U", declaredTotalQuantity: 1, items: [{ name: "Lạ", variant: "", quantity: 1 }] };
    expect((await announce([unknown])).held).toBe(false);
    expect(names()).toEqual(["Furni_10h0710_1 đơn_Đã gom.xlsx", "Furni_10h0710_1 đơn_Đã gom.pdf"]);
  });

  it("answers the same link posted again from the same draft, with the edits made to it, not a second draft", async () => {
    const first = await announce(NEEDS_HAND);
    await saveOverrides(first.draftId!, new Map([["O2", "khouni"]]));

    const again = await announce(NEEDS_HAND);

    expect(again).toMatchObject({ held: false, draftId: first.draftId });
    expect(names().slice(0, 2)).toEqual(["Furni_10h0710_2 đơn_Đã gom.xlsx", "Furni_10h0710_2 đơn_Đã gom.pdf"]);
    expect(await prisma.waybillDraft.count()).toBe(1);
  });

  it("does nothing when no order was read", async () => {
    expect(await announce([])).toEqual({ held: false, draftId: null });
    expect(sendFile).not.toHaveBeenCalled();
  });
});

describe("sendDraftFiles", () => {
  beforeEach(async () => {
    sendFile.mockReset();
    sendFile.mockResolvedValue(undefined);
    await prisma.waybillDraft.deleteMany();
  });

  it("sends the files with the kho gửi typed on the page, so a held-back order goes to the kho chosen for it", async () => {
    const pdf = await makePdf(2);
    const { draft } = await createDraft({ threadId: "G1", threadType: "group", pdfUrl: "u", pdf, pages: NEEDS_HAND, labelCount: 2 });
    await saveOverrides(draft.id, new Map([["O2", "khouni"]]));

    const result = await sendDraftFiles((await loadDraft(draft.id))!, pdf, thread, null, AT);

    expect(result).toEqual({ excelSent: true, pdfSent: true, khoSent: 4, khoFailed: 0 });
    expect(names().slice(2)).toEqual([
      "Furni_10h0710_1 đơn_Đã gom_khoLuan.xlsx",
      "Furni_10h0710_1 đơn_Đã gom_khoLuan.pdf",
      "Furni_10h0710_1 đơn_Đã gom_khouni.xlsx",
      "Furni_10h0710_1 đơn_Đã gom_khouni.pdf",
    ]);
  });
});
