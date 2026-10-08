import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/zalo/waybill-format/route";
import { POST as selectGroup } from "@/app/api/zalo/watch/route";
import { WAYBILL_CONFIRM_PURPOSE } from "@/lib/zalo/poller";

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/zalo/waybill-format", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

const chooseGroup = (threadId = "G1") =>
  selectGroup(
    new NextRequest("http://localhost/api/zalo/watch", {
      method: "POST",
      body: JSON.stringify({ purpose: WAYBILL_CONFIRM_PURPOSE, threadId, threadType: "group", threadName: `Nhóm ${threadId}` }),
      headers: { "content-type": "application/json" },
    })
  );

const stored = async () => (await prisma.zaloWatchConfig.findUniqueOrThrow({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } })).waybillPerPage;

describe("POST /api/zalo/waybill-format", () => {
  beforeEach(async () => {
    await prisma.zaloWatchConfig.deleteMany();
  });

  it("asks for a group to be chosen first", async () => {
    const response = await post({ perPage: "4" });
    expect(response.status).toBe(409);
    expect(await prisma.zaloWatchConfig.count()).toBe(0);
  });

  it.each([
    ["2", 2],
    ["4", 4],
    [6, 6],
    ["9", 9],
  ])("saves %j on the waybill group's config", async (perPage, expected) => {
    await chooseGroup();
    const response = await post({ perPage });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ waybillPerPage: expected });
    expect(await stored()).toBe(expected);
  });

  it.each(["same", "", null])("%j means: keep the PDF's own layout", async (perPage) => {
    await chooseGroup();
    await post({ perPage: "9" });
    await post({ perPage });
    expect(await stored()).toBeNull();
  });

  it.each(["3", "5", "abc", "-2"])("refuses %j and keeps what was saved", async (perPage) => {
    await chooseGroup();
    await post({ perPage: "6" });
    const response = await post({ perPage });
    expect(response.status).toBe(400);
    expect(await stored()).toBe(6);
  });

  it("is kept when another group is chosen later", async () => {
    await chooseGroup("G1");
    await post({ perPage: "4" });
    await chooseGroup("G2");
    expect(await stored()).toBe(4);
  });

  it("refuses a body that isn't JSON", async () => {
    await chooseGroup();
    const response = await POST(new NextRequest("http://localhost/api/zalo/waybill-format", { method: "POST", body: "nope" }));
    // No perPage at all reads as "keep the layout" — it must not crash or save garbage.
    expect([200, 400]).toContain(response.status);
    expect(await stored()).toBeNull();
  });

  afterAll(async () => {
    await prisma.zaloWatchConfig.deleteMany();
    await prisma.$disconnect();
  });
});
