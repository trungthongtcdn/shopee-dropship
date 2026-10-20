-- CreateTable
CREATE TABLE "shops" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secret_hash" TEXT,
    "sku_sheet_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "shops_secret_hash_key" ON "shops"("secret_hash");

-- The data the app already holds is the first shop.
INSERT INTO "shops" ("slug", "name") VALUES ('shop_1', 'Shop 1');
