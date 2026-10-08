-- The waybill PDF layout is a per-account choice, not a per-Zalo-group one.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "waybill_per_page" INTEGER;

-- AlterTable (the column was added a day earlier and never set to anything)
ALTER TABLE "zalo_watch_config" DROP COLUMN "waybill_per_page";
