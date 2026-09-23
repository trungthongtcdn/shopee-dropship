-- CreateTable
CREATE TABLE "cancel_receipt_sync_state" (
    "tracking_code" TEXT NOT NULL,
    "raw_row_hash" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cancel_receipt_sync_state_pkey" PRIMARY KEY ("tracking_code")
);
