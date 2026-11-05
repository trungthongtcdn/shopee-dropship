import { NextRequest, NextResponse } from "next/server";
import { withShop } from "@/lib/shops/guard";
import { loadDraft, saveOverrides } from "@/lib/waybill/drafts";
import { parseKhoOverrides } from "@/lib/waybill/khoGiao";

// Saves the kho gửi the team chose for the orders of a waybill draft: the whole list of edits
// ({ khoOverrides: { orderId: kho } }, "" = no kho), replacing the earlier one.
async function handlePATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let overrides: Map<string, string>;
  try {
    const body = (await request.json()) as { khoOverrides?: unknown };
    overrides = parseKhoOverrides(body?.khoOverrides ?? {});
  } catch {
    return NextResponse.json({ error: "Phần sửa kho gửi không hợp lệ" }, { status: 400 });
  }

  const draft = await loadDraft(id);
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Only orders of this draft can be edited; anything else in the list is dropped.
  const known = new Set(draft.pages.map((page) => page.shopeeOrderId));
  await saveOverrides(id, new Map([...overrides].filter(([orderId]) => known.has(orderId))));
  return NextResponse.json({ ok: true });
}

export const PATCH = withShop(handlePATCH, { check: "header" });
