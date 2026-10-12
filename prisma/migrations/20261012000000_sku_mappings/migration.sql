-- CreateTable
CREATE TABLE "sku_mappings" (
    "sku" TEXT NOT NULL,
    "mapped_key" TEXT NOT NULL,
    "fold_key" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sku_mappings_pkey" PRIMARY KEY ("sku")
);

-- CreateIndex
CREATE INDEX "sku_mappings_mapped_key_idx" ON "sku_mappings"("mapped_key");

-- CreateIndex
CREATE INDEX "sku_mappings_fold_key_idx" ON "sku_mappings"("fold_key");
