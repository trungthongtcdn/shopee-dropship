-- CreateEnum
CREATE TYPE "SourceTab" AS ENUM ('orders', 'cancellations', 'products');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('insert', 'update', 'delete');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('processing', 'done', 'error');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('matched', 'missing_in_sheet', 'missing_in_excel', 'amount_mismatch', 'status_mismatch', 'parse_error');

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "shopee_order_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "total_amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "raw_row_hash" TEXT NOT NULL,
    "sheet_row_index" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "first_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellations" (
    "id" SERIAL NOT NULL,
    "shopee_order_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "cancelled_at" TIMESTAMP(3) NOT NULL,
    "raw_row_hash" TEXT NOT NULL,
    "sheet_row_index" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "first_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "raw_row_hash" TEXT NOT NULL,
    "sheet_row_index" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "first_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_log" (
    "id" SERIAL NOT NULL,
    "source_tab" "SourceTab" NOT NULL,
    "sheet_row_index" INTEGER NOT NULL,
    "change_type" "ChangeType" NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_batches" (
    "id" SERIAL NOT NULL,
    "file_name" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_label" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'processing',

    CONSTRAINT "reconciliation_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_results" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "shopee_order_id" TEXT,
    "match_status" "MatchStatus" NOT NULL,
    "sheet_amount" DOUBLE PRECISION,
    "excel_amount" DOUBLE PRECISION,
    "diff_detail" JSONB,

    CONSTRAINT "reconciliation_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_shopee_order_id_key" ON "orders"("shopee_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- AddForeignKey
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "reconciliation_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
