import { NextRequest, NextResponse } from "next/server";
import { syncPayloadSchema, parseIncomingRows } from "@/lib/sync/validatePayload";
import { applyOrdersPayload, applyCancellationsPayload, applyProductsPayload } from "@/lib/sync/apply";

const APPLY_BY_TAB = {
  orders: applyOrdersPayload,
  cancellations: applyCancellationsPayload,
  products: applyProductsPayload,
} as const;

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-sync-secret");
  if (secret !== process.env.SYNC_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsedBody = syncPayloadSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const { tab, rows } = parsedBody.data;
  const { validRows, errors } = parseIncomingRows(rows);

  const diff = await APPLY_BY_TAB[tab](validRows);

  return NextResponse.json({
    inserted: diff.inserts.length,
    updated: diff.updates.length,
    softDeleted: diff.softDeletes.length,
    invalidRows: errors,
    dbErrors: diff.rowErrors,
  });
}
