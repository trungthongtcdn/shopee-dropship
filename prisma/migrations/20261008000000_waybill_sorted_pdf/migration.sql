-- AlterTable
ALTER TABLE "waybill_files" ADD COLUMN     "sorted_pdf_data" BYTEA,
ADD COLUMN     "sorted_pdf_name" TEXT;
