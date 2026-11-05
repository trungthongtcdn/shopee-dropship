-- CreateTable
CREATE TABLE "waybill_drafts" (
    "id" SERIAL NOT NULL,
    "thread_id" TEXT NOT NULL,
    "thread_type" TEXT NOT NULL,
    "pdf_url" TEXT NOT NULL,
    "pdf_data" BYTEA NOT NULL,
    "pages" JSONB NOT NULL,
    "layout" JSONB,
    "label_count" INTEGER,
    "kho_options" JSONB NOT NULL DEFAULT '[]',
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "waybill_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waybill_drafts_thread_id_pdf_url_key" ON "waybill_drafts"("thread_id", "pdf_url");

-- CreateIndex
CREATE INDEX "waybill_drafts_created_at_idx" ON "waybill_drafts"("created_at");
