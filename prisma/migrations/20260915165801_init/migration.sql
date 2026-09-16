-- CreateEnum
CREATE TYPE "CancellationType" AS ENUM ('cancelled', 'delivery_failed', 'returned_refunded');

-- CreateEnum
CREATE TYPE "SourceTab" AS ENUM ('orders', 'delivered_orders', 'cancelled', 'delivery_failed', 'returned_refunded', 'products');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('insert', 'update', 'delete');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('processing', 'done', 'error');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('matched', 'missing_in_sheet', 'missing_in_excel', 'status_mismatch', 'parse_error');

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "shopee_order_id" TEXT NOT NULL,
    "package_code" TEXT,
    "order_date" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "tracking_code" TEXT,
    "carrier" TEXT,
    "delivery_method" TEXT,
    "expected_delivery_date" TIMESTAMP(3),
    "order_quantity" INTEGER,
    "product_name" TEXT,
    "category_name" TEXT,
    "line_quantity" INTEGER,
    "raw_row_hash" TEXT NOT NULL,
    "sheet_row_index" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "first_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivered_orders" (
    "id" SERIAL NOT NULL,
    "shopee_order_id" TEXT NOT NULL,
    "package_code" TEXT,
    "order_date" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "tracking_code" TEXT,
    "carrier" TEXT,
    "delivered_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "return_refund_status" TEXT,
    "product_name" TEXT,
    "warehouse_name" TEXT,
    "category_name" TEXT,
    "raw_row_hash" TEXT NOT NULL,
    "sheet_row_index" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "first_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivered_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellations" (
    "id" SERIAL NOT NULL,
    "shopee_order_id" TEXT NOT NULL,
    "type" "CancellationType" NOT NULL,
    "package_code" TEXT,
    "order_date" TIMESTAMP(3),
    "status" TEXT,
    "buyer_note" TEXT,
    "tracking_code" TEXT,
    "carrier" TEXT,
    "expected_delivery_date" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "product_name" TEXT,
    "warehouse_name" TEXT,
    "category_name" TEXT,
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
    "category_name" TEXT,
    "parent_sku" TEXT,
    "import_price" DOUBLE PRECISION NOT NULL,
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
CREATE UNIQUE INDEX "orders_shopee_order_id_category_name_key" ON "orders"("shopee_order_id", "category_name");

-- CreateIndex
CREATE UNIQUE INDEX "delivered_orders_shopee_order_id_category_name_key" ON "delivered_orders"("shopee_order_id", "category_name");

-- CreateIndex
CREATE UNIQUE INDEX "cancellations_shopee_order_id_type_key" ON "cancellations"("shopee_order_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- AddForeignKey
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "reconciliation_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

