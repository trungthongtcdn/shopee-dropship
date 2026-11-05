import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { withShop } from "@/lib/shops/guard";
import { editCancellation, parseCancellationEdit } from "@/lib/cancellation/editCancellation";

// The edits of the Đơn hoàn huỷ page: "Trạng thái nhận/Check Dup", "NCC ghi chú" and the
// complaint note of one row. Nothing else on a cancellation is reachable from here — the rest is
// owned by the sync.
async function handlePATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let edit;
  try {
    edit = parseCancellationEdit(await request.json());
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }
    throw error;
  }

  if (!(await editCancellation(id, edit))) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export const PATCH = withShop(handlePATCH, { check: "header" });
