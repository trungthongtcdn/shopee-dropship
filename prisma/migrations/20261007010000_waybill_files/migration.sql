-- CreateTable
CREATE TABLE "waybill_files" (
    "confirmation_log_id" INTEGER NOT NULL,
    "xlsx_name" TEXT NOT NULL,
    "xlsx_data" BYTEA NOT NULL,
    "pdf_name" TEXT,
    "pdf_data" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waybill_files_pkey" PRIMARY KEY ("confirmation_log_id")
);

-- AddForeignKey
ALTER TABLE "waybill_files" ADD CONSTRAINT "waybill_files_confirmation_log_id_fkey" FOREIGN KEY ("confirmation_log_id") REFERENCES "zalo_confirmation_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
