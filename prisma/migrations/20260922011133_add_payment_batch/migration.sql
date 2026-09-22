-- CreateTable
CREATE TABLE "payment_batches" (
    "id" SERIAL NOT NULL,
    "week_label" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_batch_lines" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "shopee_order_id" TEXT NOT NULL,
    "sku" TEXT,
    "product_name" TEXT,
    "quantity" INTEGER,
    "sell_price" DOUBLE PRECISION,
    "service_fee" DOUBLE PRECISION,
    "tax_deduction" DOUBLE PRECISION,
    "net_amount" DOUBLE PRECISION NOT NULL,
    "sheet_row_index" INTEGER NOT NULL,
    "raw_row_hash" TEXT NOT NULL,

    CONSTRAINT "payment_batch_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_batches_week_label_key" ON "payment_batches"("week_label");

-- AddForeignKey
ALTER TABLE "payment_batch_lines" ADD CONSTRAINT "payment_batch_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payment_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
