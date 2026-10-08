import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/accounts/me/waybill-format/route";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { getSessionSecret, SESSION_COOKIE, signSession } from "@/lib/auth/session";

async function seedUser(username: string) {
  return prisma.user.create({ data: { username, passwordHash: await hashPassword("password-123") } });
}

async function post(body: unknown, userId?: number) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId !== undefined) headers.cookie = `${SESSION_COOKIE}=${await signSession(userId, getSessionSecret()!)}`;
  return POST(new NextRequest("http://localhost/api/accounts/me/waybill-format", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

const saved = async (id: number) => (await prisma.user.findUniqueOrThrow({ where: { id } })).waybillPerPage;

describe("POST /api/accounts/me/waybill-format", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  it("needs a signed-in account", async () => {
    const user = await seedUser("someone");
    expect((await post({ perPage: "4" })).status).toBe(401);
    expect(await saved(user.id)).toBeNull();
  });

  it("does not accept a signed session whose account has been deleted", async () => {
    const ghost = await seedUser("ghost");
    const cookieUserId = ghost.id;
    await prisma.user.delete({ where: { id: ghost.id } });
    expect((await post({ perPage: "4" }, cookieUserId)).status).toBe(401);
  });

  it.each([
    ["2", 2],
    ["4", 4],
    [6, 6],
    ["9", 9],
  ])("saves %j on the account", async (perPage, expected) => {
    const user = await seedUser("someone");
    const response = await post({ perPage }, user.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ waybillPerPage: expected });
    expect(await saved(user.id)).toBe(expected);
  });

  it.each(["same", "", null])("%j means: keep the uploaded PDF's own layout", async (perPage) => {
    const user = await seedUser("someone");
    await post({ perPage: "9" }, user.id);
    await post({ perPage }, user.id);
    expect(await saved(user.id)).toBeNull();
  });

  it.each(["3", "5", "abc", "-2"])("refuses %j and keeps what was saved", async (perPage) => {
    const user = await seedUser("someone");
    await post({ perPage: "6" }, user.id);
    const response = await post({ perPage }, user.id);
    expect(response.status).toBe(400);
    expect(await saved(user.id)).toBe(6);
  });

  it("keeps each account's choice separate", async () => {
    const a = await seedUser("alice");
    const b = await seedUser("bob");
    await post({ perPage: "2" }, a.id);
    await post({ perPage: "9" }, b.id);
    expect([await saved(a.id), await saved(b.id)]).toEqual([2, 9]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });
});
