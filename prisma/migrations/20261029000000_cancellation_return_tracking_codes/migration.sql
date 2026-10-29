-- All return tracking codes of an order's returned_refunded row (see the schema comment).
ALTER TABLE "cancellations" ADD COLUMN "return_tracking_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Rows synced before this column existed have just their one code; keep it findable.
UPDATE "cancellations"
SET "return_tracking_codes" = ARRAY["return_tracking_code"]
WHERE "return_tracking_code" IS NOT NULL AND "return_tracking_code" <> '';
