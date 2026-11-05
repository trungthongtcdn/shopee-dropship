import { NextRequest, NextResponse } from "next/server";
import { withShop } from "@/lib/shops/guard";
import { getUserFromRequest } from "@/lib/auth/currentUser";
import { loadDraft, loadDraftPdf } from "@/lib/waybill/drafts";
import { buildWaybillFileSet, type WaybillFile } from "@/lib/waybill/files";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// RFC 5987: plain ASCII fallback for old clients + the real UTF-8 name.
function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// A file of a waybill draft, made from the draft as it stands (its saved kho gửi edits applied):
//   ?file=excel | pdf            the overall Excel / PDF
//   ?file=kho-excel | kho-pdf&i=N  the Nth kho's own Excel / PDF (as listed on the page)
async function handleGET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await getUserFromRequest(request))) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const kind = request.nextUrl.searchParams.get("file");
  const index = Number(request.nextUrl.searchParams.get("i") ?? "0");
  if (!["excel", "pdf", "kho-excel", "kho-pdf"].includes(kind ?? "") || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "invalid file" }, { status: 400 });
  }

  const draft = await loadDraft(id);
  const sourcePdf = draft ? await loadDraftPdf(id) : null;
  if (!draft || !sourcePdf) return NextResponse.json({ error: "not found" }, { status: 404 });

  const set = await buildWaybillFileSet({
    pages: draft.pages,
    at: draft.createdAt,
    sourcePdf,
    layout: draft.layout,
    labelCount: draft.labelCount,
    overrides: draft.overrides,
    khoOptions: draft.khoOptions,
  });
  let file: WaybillFile | null | undefined;
  if (kind === "excel") file = set.excel;
  else if (kind === "pdf") file = set.pdf;
  else if (kind === "kho-excel") file = set.perKho[index]?.excel;
  else file = set.perKho[index]?.pdf;
  if (!file) return NextResponse.json({ error: "file not found" }, { status: 404 });

  return new NextResponse(file.data as unknown as BodyInit, {
    headers: {
      "Content-Type": file.name.endsWith(".xlsx") ? XLSX_TYPE : "application/pdf",
      "Content-Length": String(file.data.byteLength),
      "Content-Disposition": contentDisposition(file.name),
      "Cache-Control": "private, no-store",
    },
  });
}

export const GET = withShop(handleGET, { check: "query" });
