import { NextRequest, NextResponse } from "next/server";
import { withShop } from "@/lib/shops/guard";
import { currentShopSlug } from "@/lib/shops/context";
import { draftUrl, loadDraft, loadDraftPdf, markDraftSent, saveOverrides } from "@/lib/waybill/drafts";
import { parseKhoOverrides } from "@/lib/waybill/khoGiao";
import { sendDraftFiles } from "@/lib/waybill/announce";

// Posts the files of a waybill draft into the Zalo thread its PDF came from, with the kho gửi the team
// chose. The body may carry the latest edits ({ khoOverrides }); they are saved first.
async function handlePOST(request: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let overrides: Map<string, string> | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as { khoOverrides?: unknown };
    if (body?.khoOverrides !== undefined) overrides = parseKhoOverrides(body.khoOverrides);
  } catch {
    return NextResponse.json({ error: "Phần sửa kho gửi không hợp lệ" }, { status: 400 });
  }

  const found = await loadDraft(id);
  const pdf = found ? await loadDraftPdf(id) : null;
  if (!found || !pdf) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (overrides) {
    const known = new Set(found.pages.map((page) => page.shopeeOrderId));
    await saveOverrides(id, new Map([...overrides].filter(([orderId]) => known.has(orderId))));
  }
  const draft = (await loadDraft(id))!;

  const sent = await sendDraftFiles(draft, pdf, { id: draft.threadId, type: draft.threadType }, draftUrl(id, currentShopSlug()));
  if (sent.excelSent || sent.pdfSent) await markDraftSent(id);
  return NextResponse.json(sent);
}

export const POST = withShop(handlePOST, { check: "header" });
