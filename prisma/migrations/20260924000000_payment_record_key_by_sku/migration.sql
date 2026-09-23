-- payment_records is a fully derived/re-syncable cache (see PaymentSync.gs's
-- syncPayment) — cleared here rather than backfilled, since existing rows
-- have no sku value and the next sync cycle repopulates the table correctly
-- under the new key.
DELETE FROM "payment_records";

-- DropIndex
DROP INDEX "payment_records_shopee_order_id_key";

-- AlterTable
ALTER TABLE "payment_records" ADD COLUMN     "sku" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "payment_records_shopee_order_id_sku_key" ON "payment_records"("shopee_order_id", "sku");
