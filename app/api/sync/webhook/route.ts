import { NextRequest, NextResponse } from "next/server";
import { syncPayloadSchema, parseIncomingRows } from "@/lib/sync/validatePayload";
import {
  applyOrdersPayload,
  applyDeliveredOrdersPayload,
  applyCancelledPayload,
  applyDeliveryFailedPayload,
  applyReturnedRefundedPayload,
  applyProductsPayload,
  applySkuPricingPayload,
  applyPaymentPayload,
  applyPaymentBatchPayload,
  applyCancelReceiptPayload,
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

  const { tab, batchLabel, rows } = parsedBody.data;
  const { validRows, errors } = parseIncomingRows(rows);

  // sku_pricing is update-only (no insert/soft-delete concept), so it has its
  // own response shape rather than forcing it through the insert/update/
  // soft-delete counters every other tab reports.
  if (tab === "sku_pricing") {
    const applied = await applySkuPricingPayload(validRows);
    return NextResponse.json({
      updated: applied.updated,
      skipped: applied.skipped,
      invalidRows: errors,
      dbErrors: applied.rowErrors,
    });
  }

  // payment is upsert-only (no soft-delete concept either), same reasoning
  // as sku_pricing — its own response shape.
  if (tab === "payment") {
    const applied = await applyPaymentPayload(validRows);
    return NextResponse.json({
      upserted: applied.upserted,
      skipped: applied.skipped,
      invalidRows: errors,
      dbErrors: applied.rowErrors,
    });
  }

  // payment_batch has no fixed tab name (one per week), so the caller must
  // say which week this payload replaces.
  if (tab === "payment_batch") {
    if (!batchLabel) {
      return NextResponse.json({ error: "batchLabel required for payment_batch" }, { status: 400 });
    }
    const applied = await applyPaymentBatchPayload(batchLabel, validRows);
    return NextResponse.json({
      lineCount: applied.lineCount,
      invalidRows: errors,
      dbErrors: applied.rowErrors,
    });
  }

  // cancel_receipt matches by trackingCode (updateMany, no soft-delete
  // concept) — its own response shape, same reasoning as sku_pricing/payment.
  if (tab === "cancel_receipt") {
    const applied = await applyCancelReceiptPayload(validRows);
    return NextResponse.json({
      updated: applied.updated,
      unchanged: applied.unchanged,
      skipped: applied.skipped,
      invalidRows: errors,
      dbErrors: applied.rowErrors,
    });
  }

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
