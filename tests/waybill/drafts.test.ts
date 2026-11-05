import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { createDraft, draftUrl, findDraft, loadDraft, loadDraftPdf, markDraftSent, needsHandFill, pruneDrafts, saveOverrides } from "@/lib/waybill/drafts";
import type { WaybillPage } from "@/lib/waybill/items";

const page = (id: string, khos: (string | undefined)[]): WaybillPage => ({
  pageIndex: 0,
  shopeeOrderId: id,
  trackingCode: `T_${id}`,
  declaredTotalQuantity: 1,
  items: [{ name: "x", variant: "", quantity: 1, sku: "S", kiotLines: khos.map((khoGiao) => ({ sku: "S", quantity: 1, kiotCode: "K", ...(khoGiao ? { khoGiao } : {}) })) }],
});

const input = (pdfUrl = "https://cdn/x.pdf") => ({
  threadId: "T1",
  threadType: "group" as const,
  pdfUrl,
  pdf: Buffer.from("%PDF-fake"),
  pages: [page("A", ["khouni"]), page("B", ["khouni", "khoLuan"])],
  layout: { cols: 2, rows: 2, occupied: [0, 1] },
  labelCount: 2,
  khoOptions: ["khoLuan", "khouni"],
});

describe("waybill drafts", () => {
  beforeEach(async () => {
    await prisma.waybillDraft.deleteMany();
  });

  it("keeps the PDF, the orders with their Kiot lines, the layout and the kho the sheet knows", async () => {
    const { draft, created } = await createDraft(input());

    expect(created).toBe(true);
    const loaded = (await loadDraft(draft.id))!;
    expect(loaded).toMatchObject({ threadId: "T1", threadType: "group", pdfUrl: "https://cdn/x.pdf", labelCount: 2, khoOptions: ["khoLuan", "khouni"], sentAt: null });
    expect(loaded.layout).toEqual({ cols: 2, rows: 2, occupied: [0, 1] });
    expect(loaded.pages.map((p) => p.shopeeOrderId)).toEqual(["A", "B"]);
    expect(loaded.pages[1].items[0].kiotLines?.[0].khoGiao).toBe("khouni");
    expect((await loadDraftPdf(draft.id))?.toString()).toBe("%PDF-fake");
  });

  it("finds the same draft again for the same PDF in the same thread, edits and all, instead of making a second", async () => {
    const first = (await createDraft(input())).draft;
    await saveOverrides(first.id, new Map([["B", "khouni"]]));

    const again = await createDraft(input());

    expect(again.created).toBe(false);
    expect(again.draft.id).toBe(first.id);
    // ...but it holds what was read this time
    const fresh = await createDraft({ ...input(), pages: [page("Z", ["khoLuan"])], labelCount: 1 });
    expect(fresh.draft.pages.map((p) => p.shopeeOrderId)).toEqual(["Z"]);
    expect([...fresh.draft.overrides]).toEqual([["B", "khouni"]]);
    expect([...again.draft.overrides]).toEqual([["B", "khouni"]]);
    expect(await prisma.waybillDraft.count()).toBe(1);
    expect((await findDraft("T1", "https://cdn/x.pdf"))?.id).toBe(first.id);
    expect(await findDraft("T1", "https://cdn/other.pdf")).toBeNull();
  });

  it("replaces the edits as a whole and notes when the files were sent", async () => {
    const { draft } = await createDraft(input());
    await saveOverrides(draft.id, new Map([["A", "khoLuan"]]));
    await saveOverrides(draft.id, new Map([["B", "khouni"]]));
    await markDraftSent(draft.id, new Date("2026-11-05T01:00:00Z"));

    const loaded = (await loadDraft(draft.id))!;
    expect([...loaded.overrides]).toEqual([["B", "khouni"]]);
    expect(loaded.sentAt?.toISOString()).toBe("2026-11-05T01:00:00.000Z");
    expect(await saveOverrides(draft.id + 999, new Map())).toBe(false);
  });

  it("treats an unreadable stored edit list as no edits", async () => {
    const { draft } = await createDraft(input());
    await prisma.waybillDraft.update({ where: { id: draft.id }, data: { overrides: ["bad"] } });
    expect([...(await loadDraft(draft.id))!.overrides]).toEqual([]);
  });

  it("drops drafts older than two weeks and keeps the rest", async () => {
    const old = (await createDraft(input("https://cdn/old.pdf"))).draft;
    await createDraft(input("https://cdn/new.pdf"));
    await prisma.waybillDraft.update({ where: { id: old.id }, data: { createdAt: new Date("2026-10-01T00:00:00Z") } });

    expect(await pruneDrafts(new Date("2026-11-05T00:00:00Z"))).toBe(1);
    expect(await loadDraft(old.id)).toBeNull();
    expect(await prisma.waybillDraft.count()).toBe(1);
  });
});

describe("needsHandFill", () => {
  const mixed = page("M", ["khouni", "khoLuan"]);

  it("is true while an order's Kiot codes are in different kho and nobody chose one", () => {
    expect(needsHandFill([page("A", ["khouni"]), mixed])).toBe(true);
  });

  it("is false once every such order has a kho, or when the sheet simply knows nothing of an order", () => {
    expect(needsHandFill([mixed], new Map([["M", "khouni"]]))).toBe(false);
    expect(needsHandFill([page("U", [undefined])])).toBe(false);
    expect(needsHandFill([])).toBe(false);
  });

  it("is true again when an edit empties the kho", () => {
    expect(needsHandFill([mixed], new Map([["M", ""]]))).toBe(true);
  });
});

describe("draftUrl", () => {
  const saved = process.env.PUBLIC_BASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = saved;
  });

  it("is the draft page on the site's address, with the shop it belongs to", () => {
    process.env.PUBLIC_BASE_URL = "https://example.test/";
    expect(draftUrl(7, "shop_2")).toBe("https://example.test/dashboard/dong-don/phieu/7?shop=shop_2");
  });

  it("is null when the address isn't configured", () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(draftUrl(7, "shop_1")).toBeNull();
  });
});
