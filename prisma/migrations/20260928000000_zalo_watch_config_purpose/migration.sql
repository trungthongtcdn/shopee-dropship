-- ZaloWatchConfig stops being a singleton (id always 1) and gains a
-- `purpose` column identifying which thing it's watching for. The existing
-- row (the waybill-confirm group already configured in production) is
-- preserved and backfilled to purpose='waybill_confirm', not dropped.
ALTER TABLE "zalo_watch_config" ADD COLUMN "purpose" TEXT;
UPDATE "zalo_watch_config" SET "purpose" = 'waybill_confirm' WHERE "purpose" IS NULL;
ALTER TABLE "zalo_watch_config" ALTER COLUMN "purpose" SET NOT NULL;
ALTER TABLE "zalo_watch_config" DROP CONSTRAINT "zalo_watch_config_pkey";
ALTER TABLE "zalo_watch_config" DROP COLUMN "id";
ALTER TABLE "zalo_watch_config" ADD CONSTRAINT "zalo_watch_config_pkey" PRIMARY KEY ("purpose");

-- CreateTable
CREATE TABLE "zalo_cancel_receipt_logs" (
    "id" SERIAL NOT NULL,
    "thread_id" TEXT NOT NULL,
    "message_content" TEXT NOT NULL,
    "codes" JSONB NOT NULL,
    "matched_count" INTEGER NOT NULL,
    "confirmed_by_name" TEXT,
    "confirmed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zalo_cancel_receipt_logs_pkey" PRIMARY KEY ("id")
);
