import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { prisma, sharedPrisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { getSessionSecret, SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { makePdf, pageWidths } from "../waybill/pdfFixture";

const sendFile = vi.fn(async () => {});
vi.mock("@/lib/zalo/bridge", () => ({ sendFile: (...args: unknown[]) => (sendFile as (...a: unknown[]) => Promise<void>)(...args) }));

import { PATCH } from "@/app/api/waybill-drafts/[id]/route";
import { POST } from "@/app/api/waybill-drafts/[id]/send/route";
import { GET } from "@/app/api/waybill-drafts/[id]/file/route";
import { createDraft, loadDraft } from "@/lib/waybill/drafts";
import type { WaybillPage } from "@/lib/waybill/items";

function page(pageIndex: number, orderId: string, khos: string[]): WaybillPage {
  return {
    pageIndex,
    shopeeOrderId: orderId,
    trackingCode: `TRK_${orderId}`,
    declaredTotalQuantity: 1,
    items: [{ name: orderId, variant: "V", quantity: 1, sku: orderId, kiotLines: khos.map((khoGiao) => ({ sku: orderId, quantity: 1, kiotCode: `K_${orderId}`, khoGiao })) }],
  };
}
const PAGES = [page(0, "O1", ["khoLuan"]), page(1, "O2", ["khoLuan", "khouni"]), page(2, "O3", ["khouni"])];

async function seed() {
  return (await createDraft({ threadId: "G1", threadType: "group", pdfUrl: "https://cdn/x.pdf", pdf: await makePdf(3), pages: PAGES, labelCount: 3, khoOptions: ["khoLuan", "khouni"] })).draft;
}

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("PATCH /api/waybill-drafts/[id]", () => {
  beforeEach(async () => {
    await prisma.waybillDraft.deleteMany();
  });

  it("saves the kho gửi edits, dropping orders that are not in the draft", async () => {
    const draft = await seed();
    const response = await PATCH(json(`http://localhost/api/waybill-drafts/${draft.id}`, "PATCH", { khoOverrides: { O2: "khouni", NOPE: "khoLuan" } }), { params: { id: String(draft.id) } });

    expect(response.status).toBe(200);
    expect([...(await loadDraft(draft.id))!.overrides]).toEqual([["O2", "khouni"]]);
  });

  it("replaces the earlier edits, so sending {} takes them all back", async () => {
    const draft = await seed();
    await PATCH(json("http://localhost/x", "PATCH", { khoOverrides: { O2: "khouni" } }), { params: { id: String(draft.id) } });
    await PATCH(json("http://localhost/x", "PATCH", { khoOverrides: {} }), { params: { id: String(draft.id) } });
    expect([...(await loadDraft(draft.id))!.overrides]).toEqual([]);
  });

  it("answers 400 for a bad id or bad edits, and 404 for a draft that isn't there", async () => {
    const draft = await seed();
    expect((await PATCH(json("http://localhost/x", "PATCH", {}), { params: { id: "abc" } })).status).toBe(400);
    expect((await PATCH(json("http://localhost/x", "PATCH", { khoOverrides: { O2: "a/b" } }), { params: { id: String(draft.id) } })).status).toBe(400);
    expect((await PATCH(json("http://localhost/x", "PATCH", "{nope"), { params: { id: String(draft.id) } })).status).toBe(400);
    expect((await PATCH(json("http://localhost/x", "PATCH", { khoOverrides: {} }), { params: { id: "99999" } })).status).toBe(404);
  });
});

describe("POST /api/waybill-drafts/[id]/send", () => {
  beforeEach(async () => {
    sendFile.mockReset();
    sendFile.mockResolvedValue(undefined);
    await prisma.waybillDraft.deleteMany();
  });

  it("posts the files into the thread the PDF came from, with the edits that came with the request, and marks the draft sent", async () => {
    const draft = await seed();
    const response = await POST(json("http://localhost/x", "POST", { khoOverrides: { O2: "khouni" } }), { params: { id: String(draft.id) } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ excelSent: true, pdfSent: true, khoSent: 4, khoFailed: 0 });
    const calls = sendFile.mock.calls as unknown as [string, string, string, Buffer, string][];
    expect(calls.every((call) => call[0] === "G1" && call[1] === "group")).toBe(true);
    expect(calls.map((call) => call[2].replace(/^Furni_\d+h\d{4}_/, ""))).toEqual([
      "3 đơn_Đã gom.xlsx",
      "3 đơn_Đã gom.pdf",
      "1 đơn_Đã gom_khoLuan.xlsx",
      "1 đơn_Đã gom_khoLuan.pdf",
      "2 đơn_Đã gom_khouni.xlsx",
      "2 đơn_Đã gom_khouni.pdf",
    ]);
    const saved = (await loadDraft(draft.id))!;
    expect([...saved.overrides]).toEqual([["O2", "khouni"]]);
    expect(saved.sentAt).toBeInstanceOf(Date);
  });

  it("uses the edits already saved when the request brings none", async () => {
    const draft = await seed();
    await PATCH(json("http://localhost/x", "PATCH", { khoOverrides: { O2: "khoLuan" } }), { params: { id: String(draft.id) } });

    const response = await POST(json("http://localhost/x", "POST", {}), { params: { id: String(draft.id) } });

    expect((await response.json()).khoSent).toBe(4);
    const khoFiles = (sendFile.mock.calls as unknown as string[][]).map((call) => call[2]).filter((name) => /_kho/.test(name));
    expect(khoFiles.map((name) => name.replace(/^.*_(kho\w+)\..*$/, "$1"))).toEqual(["khoLuan", "khoLuan", "khouni", "khouni"]);
  });

  it("does not mark the draft sent when nothing could be posted", async () => {
    const draft = await seed();
    sendFile.mockRejectedValue(new Error("zalo down"));
    const response = await POST(json("http://localhost/x", "POST", {}), { params: { id: String(draft.id) } });
    expect(await response.json()).toMatchObject({ excelSent: false, pdfSent: false });
    expect((await loadDraft(draft.id))!.sentAt).toBeNull();
  });

  it("answers 400 for a bad id or bad edits and 404 for a missing draft", async () => {
    const draft = await seed();
    expect((await POST(json("http://localhost/x", "POST", {}), { params: { id: "x" } })).status).toBe(400);
    expect((await POST(json("http://localhost/x", "POST", { khoOverrides: [1] }), { params: { id: String(draft.id) } })).status).toBe(400);
    expect((await POST(json("http://localhost/x", "POST", {}), { params: { id: "99999" } })).status).toBe(404);
    expect(sendFile).not.toHaveBeenCalled();
  });
});

describe("GET /api/waybill-drafts/[id]/file", () => {
  let cookie = "";
  beforeEach(async () => {
    await prisma.waybillDraft.deleteMany();
    await sharedPrisma.user.deleteMany({ where: { username: "draft_tester" } });
    const user = await sharedPrisma.user.create({ data: { username: "draft_tester", passwordHash: await hashPassword("password-123") } });
    cookie = `${SESSION_COOKIE}=${await signSession(user.id, getSessionSecret()!)}`;
  });
  afterAll(async () => {
    await sharedPrisma.user.deleteMany({ where: { username: "draft_tester" } });
    await prisma.waybillDraft.deleteMany();
  });

  const get = (id: number | string, query: string, withCookie = true) =>
    GET(new NextRequest(`http://localhost/api/waybill-drafts/${id}/file?${query}`, { headers: withCookie ? { cookie } : {} }), { params: { id: String(id) } });

  it("needs a signed-in account", async () => {
    const draft = await seed();
    expect((await get(draft.id, "file=excel", false)).status).toBe(401);
  });

  it("serves the overall Excel and PDF, kho by kho, with the empty kho last", async () => {
    const draft = await seed();

    const excel = await get(draft.id, "file=excel");
    expect(excel.status).toBe(200);
    expect(excel.headers.get("content-type")).toContain("spreadsheetml");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await excel.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const tracking: string[] = [];
    workbook.worksheets[0].eachRow((row, i) => i > 1 && tracking.push(String(row.getCell(5).value)));
    expect(tracking).toEqual(["TRK_O1", "TRK_O3", "TRK_O2"]);

    const pdf = await get(draft.id, "file=pdf");
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect((await pageWidths(Buffer.from(await pdf.arrayBuffer()))).map((w) => w - 101)).toEqual([0, 2, 1]);
  });

  it("serves one kho's own files by position, after the edits", async () => {
    const draft = await seed();
    await PATCH(json("http://localhost/x", "PATCH", { khoOverrides: { O2: "khouni" } }), { params: { id: String(draft.id) } });

    const pdf = await get(draft.id, "file=kho-pdf&i=1");
    expect((await pageWidths(Buffer.from(await pdf.arrayBuffer()))).map((w) => w - 101)).toEqual([1, 2]);
    expect((await get(draft.id, "file=kho-excel&i=1")).status).toBe(200);
    expect((await get(draft.id, "file=kho-excel&i=2")).status).toBe(404);
  });

  it("answers 400 for an unknown file kind and 404 for a missing draft", async () => {
    const draft = await seed();
    expect((await get(draft.id, "file=zip")).status).toBe(400);
    expect((await get(draft.id, "file=kho-pdf&i=-1")).status).toBe(400);
    expect((await get(99999, "file=excel")).status).toBe(404);
  });
});
