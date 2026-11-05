-- CreateTable
CREATE TABLE "kiot_snapshots" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "records" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kiot_snapshots_pkey" PRIMARY KEY ("id")
);
