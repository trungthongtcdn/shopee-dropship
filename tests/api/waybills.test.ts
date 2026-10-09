import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/waybills/[logId]/[kind]/route";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { getSessionSecret, SESSION_COOKIE, signSession } from "@/lib/auth/session";

async function signedInRequest(path: string) {
  const user = await prisma.user.upsert({
    where: { username: "waybill-tester" },
    update: {},
    create: { username: "waybill-tester", passwordHash: await hashPassword("password-123") },
  });
  const token = await signSession(user.id, getSessionSecret()!);
  return new NextRequest(`http://localhost${path}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
}

async function seedFile(extra: { pdfName?: string; pdfData?: Buffer; sortedPdfName?: string; sortedPdfData?: Buffer } = {}) {
  const log = await prisma.zaloConfirmationLog.create({
    data: { threadId: "manual", pdfUrl: "upload:x.pdf", orderIds: [], matchedCount: 0 },
  });
  await prisma.waybillFile.create({
    data: { confirmationLogId: log.id, xlsxName: "danh-sach.xlsx", xlsxData: Buffer.from("XLSXBYTES"), ...extra },
  });
  return log.id;
}

const call = async (logId: number | string, kind: string, signedIn = true) => {
  const request = signedIn
    ? await signedInRequest(`/api/waybills/${logId}/${kind}`)
    : new NextRequest(`http://localhost/api/waybills/${logId}/${kind}`);
  return GET(request, { params: { logId: String(logId), kind } });
};

describe("GET /api/waybills/[logId]/[kind]", () => {
  beforeEach(async () => {
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
  });

  it("downloads the stored Excel as an attachment with its own file name", async () => {
    const id = await seedFile();
    const response = await call(id, "xlsx");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="danh-sach\.xlsx"/);
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("XLSXBYTES");
  });

  it("opens an uploaded PDF inline, keeping a Vietnamese file name intact", async () => {
    const id = await seedFile({ pdfName: "Phiếu gửi hàng (1).pdf", pdfData: Buffer.from("%PDF-bytes") });
    const response = await call(id, "pdf");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const disposition = response.headers.get("content-disposition")!;
    expect(disposition).toMatch(/^inline; /);
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent("Phiếu gửi hàng (1).pdf")}`);
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("%PDF-bytes");
  });

  it("opens the re-ordered PDF inline", async () => {
    const id = await seedFile({ sortedPdfName: "Furni_10h0710_3 đơn_Đã gom.pdf", sortedPdfData: Buffer.from("%PDF-sorted") });
    const response = await call(id, "sorted-pdf");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    // The name has accents and spaces: an ASCII fallback for old clients, the real name for the rest.
    const name = "Furni_10h0710_3 đơn_Đã gom.pdf";
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("%PDF-sorted");
  });

  it("404s a re-ordered PDF that wasn't made (rows from before the feature, or a PDF that couldn't be re-ordered)", async () => {
    const id = await seedFile();
    expect((await call(id, "sorted-pdf")).status).toBe(404);
  });

  it("404s a PDF that was never stored (link PDFs are opened from their own URL)", async () => {
    const id = await seedFile();
    expect((await call(id, "pdf")).status).toBe(404);
  });

  it("404s an unknown log row, an unknown kind, and 400s a non-numeric id", async () => {
    expect((await call(999999, "xlsx")).status).toBe(404);
    const id = await seedFile();
    expect((await call(id, "exe")).status).toBe(404);
    expect((await call("abc", "xlsx")).status).toBe(400);
  });

  it("refuses a request without a session", async () => {
    const id = await seedFile();
    expect((await call(id, "xlsx", false)).status).toBe(401);
  });

  afterAll(async () => {
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.user.deleteMany({ where: { username: "waybill-tester" } });
    await prisma.$disconnect();
  });
});
