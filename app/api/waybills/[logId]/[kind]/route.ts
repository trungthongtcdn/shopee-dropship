import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth/currentUser";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// RFC 5987: plain ASCII fallback for old clients + the real UTF-8 name, since an
// uploaded PDF can be called anything ("Phiếu gửi hàng (1).pdf").
function contentDisposition(disposition: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// Serves what lib/waybill/deliver.ts stored: the grouped Excel ("xlsx"), the
// source PDF with its pages re-ordered like the Excel ("sorted-pdf"), and — for
// hand-uploaded PDFs only — the original PDF ("pdf").
export async function GET(request: NextRequest, { params }: { params: { logId: string; kind: string } }) {
  if (!(await getUserFromRequest(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const logId = Number(params.logId);
  if (!Number.isInteger(logId)) return NextResponse.json({ error: "invalid log id" }, { status: 400 });

  let name: string | null = null;
  let data: Uint8Array | null = null;
  let contentType = "";
  let disposition: "inline" | "attachment" = "attachment";

  if (params.kind === "xlsx") {
    const file = await prisma.waybillFile.findUnique({
      where: { confirmationLogId: logId },
      select: { xlsxName: true, xlsxData: true },
    });
    name = file?.xlsxName ?? null;
    data = file?.xlsxData ?? null;
    contentType = XLSX_TYPE;
  } else if (params.kind === "pdf") {
    const file = await prisma.waybillFile.findUnique({
      where: { confirmationLogId: logId },
      select: { pdfName: true, pdfData: true },
    });
    name = file?.pdfName ?? null;
    data = file?.pdfData ?? null;
    contentType = "application/pdf";
    disposition = "inline";
  } else if (params.kind === "sorted-pdf") {
    const file = await prisma.waybillFile.findUnique({
      where: { confirmationLogId: logId },
      select: { sortedPdfName: true, sortedPdfData: true },
    });
    name = file?.sortedPdfName ?? null;
    data = file?.sortedPdfData ?? null;
    contentType = "application/pdf";
    disposition = "inline";
  } else {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!name || !data) return NextResponse.json({ error: "file not found" }, { status: 404 });

  return new NextResponse(data as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
      "Content-Disposition": contentDisposition(disposition, name),
      "Cache-Control": "private, no-store",
    },
  });
}
