import { NextRequest, NextResponse } from "next/server";
import { syncPayloadSchema, parseIncomingRows } from "@/lib/sync/validatePayload";
import {
  applyOrdersPayload,
  applyDeliveredOrdersPayload,
  applyCancelledPayload,
  applyDeliveryFailedPayload,
  applyReturnedRefundedPayload,
  applyProductsPayload,
} from "@/lib/sync/apply";

const APPLY_BY_TAB = {
  orders: applyOrdersPayload,
  delivered_orders: applyDeliveredOrdersPayload,
  cancelled: applyCancelledPayload,
  delivery_failed: applyDeliveryFailedPayload,
  returned_refunded: applyReturnedRefundedPayload,
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

  // Counts come from applyTabPayload's per-phase success counters, so they
  // report work that actually landed in the DB rather than work attempted.
  const applied = await APPLY_BY_TAB[tab](validRows);

  return NextResponse.json({
    inserted: applied.inserted,
    updated: applied.updated,
    softDeleted: applied.softDeleted,
    invalidRows: errors,
    dbErrors: applied.rowErrors,
  });
}
