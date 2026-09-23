-- AlterEnum
ALTER TYPE "SourceTab" ADD VALUE 'cancel_receipt';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancel_received_at" TIMESTAMP(3);
