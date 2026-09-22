-- AlterEnum
ALTER TYPE "SourceTab" ADD VALUE 'payment';

-- CreateTable
CREATE TABLE "payment_records" (
    "id" SERIAL NOT NULL,
    "shopee_order_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "raw_row_hash" TEXT NOT NULL,
    "first_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_records_shopee_order_id_key" ON "payment_records"("shopee_order_id");
