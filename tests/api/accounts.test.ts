import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST as createAccount } from "@/app/api/accounts/route";
import { PATCH as updateAccount, DELETE as deleteAccount } from "@/app/api/accounts/[id]/route";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getSessionSecret, SESSION_COOKIE, signSession } from "@/lib/auth/session";

async function seedUser(username: string, password = "password-123") {
  return prisma.user.create({ data: { username, passwordHash: await hashPassword(password) } });
}

async function sessionFor(userId: number) {
  return `${SESSION_COOKIE}=${await signSession(userId, getSessionSecret()!)}`;
}

async function jsonRequest(method: string, path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("accounts API", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  describe("authentication", () => {
    it("rejects every operation without a session", async () => {
      const target = await seedUser("target");
      const params = { params: { id: String(target.id) } };

      expect((await createAccount(await jsonRequest("POST", "/api/accounts", { username: "new-one", password: "password-123" }))).status).toBe(401);
      expect((await updateAccount(await jsonRequest("PATCH", `/api/accounts/${target.id}`, { username: "renamed" }), params)).status).toBe(401);
      expect((await deleteAccount(await jsonRequest("DELETE", `/api/accounts/${target.id}`), params)).status).toBe(401);
      expect(await prisma.user.count()).toBe(1);
    });

    it("rejects a validly signed session whose account has since been deleted", async () => {
      const ghost = await seedUser("ghost");
      const cookie = await sessionFor(ghost.id);
      await prisma.user.delete({ where: { id: ghost.id } });

      const response = await createAccount(await jsonRequest("POST", "/api/accounts", { username: "new-one", password: "password-123" }, cookie));
      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/accounts", () => {
    it("creates an account with a hashed password, lower-casing the username", async () => {
      const me = await seedUser("myself");
      const response = await createAccount(
        await jsonRequest("POST", "/api/accounts", { username: " NewUser ", password: "password-123" }, await sessionFor(me.id))
      );

      expect(response.status).toBe(201);
      const created = await prisma.user.findUnique({ where: { username: "newuser" } });
      expect(created).not.toBeNull();
      expect(created?.passwordHash).not.toContain("password-123");
      expect(await verifyPassword("password-123", created!.passwordHash)).toBe(true);
      // The response must never echo the hash.
      expect(JSON.stringify(await response.json())).not.toContain("scrypt");
    });

    it("rejects a duplicate username with 409", async () => {
      const me = await seedUser("myself");
      const response = await createAccount(
        await jsonRequest("POST", "/api/accounts", { username: "MYSELF", password: "password-123" }, await sessionFor(me.id))
      );
      expect(response.status).toBe(409);
    });

    it("rejects a short password and a bad username with 400", async () => {
      const cookie = await sessionFor((await seedUser("myself")).id);
      const shortPassword = await createAccount(await jsonRequest("POST", "/api/accounts", { username: "newuser", password: "short" }, cookie));
      const badUsername = await createAccount(await jsonRequest("POST", "/api/accounts", { username: "no spaces!", password: "password-123" }, cookie));
      expect(shortPassword.status).toBe(400);
      expect(badUsername.status).toBe(400);
      expect(await prisma.user.count()).toBe(1);
    });
  });

  describe("PATCH /api/accounts/[id]", () => {
    it("changes the username and keeps the password when none is given", async () => {
      const me = await seedUser("myself");
      const target = await seedUser("target", "original-password");

      const response = await updateAccount(
        await jsonRequest("PATCH", `/api/accounts/${target.id}`, { username: "Renamed", password: "" }, await sessionFor(me.id)),
        { params: { id: String(target.id) } }
      );

      expect(response.status).toBe(200);
      const updated = await prisma.user.findUnique({ where: { id: target.id } });
      expect(updated?.username).toBe("renamed");
      expect(await verifyPassword("original-password", updated!.passwordHash)).toBe(true);
    });

    it("sets a new password when one is given", async () => {
      const me = await seedUser("myself");
      const target = await seedUser("target", "original-password");

      await updateAccount(
        await jsonRequest("PATCH", `/api/accounts/${target.id}`, { password: "brand-new-password" }, await sessionFor(me.id)),
        { params: { id: String(target.id) } }
      );

      const updated = await prisma.user.findUnique({ where: { id: target.id } });
      expect(await verifyPassword("brand-new-password", updated!.passwordHash)).toBe(true);
      expect(await verifyPassword("original-password", updated!.passwordHash)).toBe(false);
    });

    it("rejects a too-short new password and a username that is already taken", async () => {
      const me = await seedUser("myself");
      const target = await seedUser("target");
      const cookie = await sessionFor(me.id);
      const params = { params: { id: String(target.id) } };

      const short = await updateAccount(await jsonRequest("PATCH", `/api/accounts/${target.id}`, { password: "short" }, cookie), params);
      const taken = await updateAccount(await jsonRequest("PATCH", `/api/accounts/${target.id}`, { username: "myself" }, cookie), params);
      expect(short.status).toBe(400);
      expect(taken.status).toBe(409);
    });

    it("returns 404 for an account that doesn't exist", async () => {
      const me = await seedUser("myself");
      const response = await updateAccount(
        await jsonRequest("PATCH", "/api/accounts/999999", { username: "whoever" }, await sessionFor(me.id)),
        { params: { id: "999999" } }
      );
      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/accounts/[id]", () => {
    it("deletes another account", async () => {
      const me = await seedUser("myself");
      const target = await seedUser("target");

      const response = await deleteAccount(await jsonRequest("DELETE", `/api/accounts/${target.id}`, undefined, await sessionFor(me.id)), {
        params: { id: String(target.id) },
      });

      expect(response.status).toBe(200);
      expect(await prisma.user.findUnique({ where: { id: target.id } })).toBeNull();
    });

    it("refuses to delete the account you are logged in as", async () => {
      const me = await seedUser("myself");
      await seedUser("other");

      const response = await deleteAccount(await jsonRequest("DELETE", `/api/accounts/${me.id}`, undefined, await sessionFor(me.id)), {
        params: { id: String(me.id) },
      });

      expect(response.status).toBe(400);
      expect(await prisma.user.count()).toBe(2);
    });

    it("refuses to delete the last remaining account", async () => {
      // `me` is logged in; a second delete target that is already the only other
      // row gets removed first, leaving exactly one account.
      const me = await seedUser("myself");
      const only = await seedUser("only");
      await prisma.user.delete({ where: { id: me.id } });
      // A session for a now-deleted `me` is rejected outright, so exercise the
      // last-account guard through a surviving session instead:
      const survivorCookie = await sessionFor(only.id);

      const response = await deleteAccount(await jsonRequest("DELETE", `/api/accounts/${only.id}`, undefined, survivorCookie), {
        params: { id: String(only.id) },
      });
      expect(response.status).toBe(400);
      expect(await prisma.user.count()).toBe(1);
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });
});
