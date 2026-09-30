-- AlterTable
ALTER TABLE "cancellations" ADD COLUMN     "complaint_reason" TEXT,
ADD COLUMN     "line_quantity" INTEGER,
ADD COLUMN     "respond_by_at" TIMESTAMP(3),
ADD COLUMN     "shopee_note" TEXT,
ADD COLUMN     "supplier_note" TEXT;
