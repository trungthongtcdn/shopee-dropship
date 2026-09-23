-- CreateTable
CREATE TABLE "zalo_watch_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "thread_id" TEXT NOT NULL,
    "thread_type" TEXT NOT NULL,
    "thread_name" TEXT NOT NULL,
    "last_processed_msg_id" TEXT,
    "pending_pdf_url" TEXT,
    "pending_pdf_msg_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zalo_watch_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zalo_confirmation_logs" (
    "id" SERIAL NOT NULL,
    "thread_id" TEXT NOT NULL,
    "pdf_url" TEXT NOT NULL,
    "order_ids" JSONB NOT NULL,
    "matched_count" INTEGER NOT NULL,
    "confirmed_by_name" TEXT,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zalo_confirmation_logs_pkey" PRIMARY KEY ("id")
);
