import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("prisma schema", () => {
  it("connects and reads empty tables", async () => {
    await expect(prisma.order.count()).resolves.toBe(0);
    await expect(prisma.cancellation.count()).resolves.toBe(0);
    await expect(prisma.product.count()).resolves.toBe(0);
    await expect(prisma.syncLog.count()).resolves.toBe(0);
    await expect(prisma.reconciliationBatch.count()).resolves.toBe(0);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
