-- cancel_receipt_sync_state is a pure derived dedup cache (skip-if-unchanged
-- bookkeeping for applyCancelReceiptPayload, see prisma/schema.prisma) —
-- cleared here rather than backfilled, since existing rows have no
-- shopee_order_id value and the next cancel_receipt sync cycle repopulates
-- the table correctly under the new (trackingCode, shopeeOrderId) shape.
DELETE FROM "cancel_receipt_sync_state";

-- AlterTable
ALTER TABLE "cancel_receipt_sync_state" ADD COLUMN     "shopee_order_id" TEXT NOT NULL;
