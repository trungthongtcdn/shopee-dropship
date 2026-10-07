import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { getSessionSecret, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

function loginRequest(body: unknown) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  const originalUser = process.env.DASHBOARD_USER;
  const originalPassword = process.env.DASHBOARD_PASSWORD;

  beforeEach(async () => {
    await prisma.user.deleteMany();
    delete process.env.DASHBOARD_USER;
    delete process.env.DASHBOARD_PASSWORD;
  });

  afterEach(() => {
    if (originalUser === undefined) delete process.env.DASHBOARD_USER;
    else process.env.DASHBOARD_USER = originalUser;
    if (originalPassword === undefined) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = originalPassword;
  });

  async function seedUser(username: string, password: string) {
    return prisma.user.create({ data: { username, passwordHash: await hashPassword(password) } });
  }

  it("logs in with correct credentials and sets a signed, httpOnly session cookie for that user", async () => {
    const user = await seedUser("luan", "password-123");

    const response = await login(loginRequest({ username: "luan", password: "password-123" }));

    expect(response.status).toBe(200);
    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(await verifySession(cookie?.value, getSessionSecret())).toEqual({ userId: user.id });
  });

  it("treats the username case-insensitively and ignores surrounding spaces", async () => {
    await seedUser("luan", "password-123");
    const response = await login(loginRequest({ username: "  LuAn ", password: "password-123" }));
    expect(response.status).toBe(200);
  });

  it("rejects a wrong password and sets no cookie", async () => {
    await seedUser("luan", "password-123");
    const response = await login(loginRequest({ username: "luan", password: "nope-nope-nope" }));
    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("gives an unknown user the same answer as a wrong password", async () => {
    await seedUser("luan", "password-123");
    const unknown = await login(loginRequest({ username: "ghost", password: "password-123" }));
    const wrong = await login(loginRequest({ username: "luan", password: "wrong-wrong" }));
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it("rejects a malformed body", async () => {
    const response = await login(loginRequest({ username: "luan" }));
    expect(response.status).toBe(400);
  });

  describe("first-login bootstrap from DASHBOARD_USER / DASHBOARD_PASSWORD", () => {
    beforeEach(() => {
      process.env.DASHBOARD_USER = "Luan";
      process.env.DASHBOARD_PASSWORD = "legacy-shared-password";
    });

    it("creates the first account when no account exists yet and the env pair matches", async () => {
      const response = await login(loginRequest({ username: "luan", password: "legacy-shared-password" }));

      expect(response.status).toBe(200);
      const created = await prisma.user.findUnique({ where: { username: "luan" } });
      expect(created).not.toBeNull();
      expect(created?.passwordHash).not.toContain("legacy-shared-password");

      // ...and from then on it's an ordinary account.
      const again = await login(loginRequest({ username: "luan", password: "legacy-shared-password" }));
      expect(again.status).toBe(200);
      expect(await prisma.user.count()).toBe(1);
    });

    it("does not bootstrap on a wrong env password", async () => {
      const response = await login(loginRequest({ username: "luan", password: "something-else-entirely" }));
      expect(response.status).toBe(401);
      expect(await prisma.user.count()).toBe(0);
    });

    it("stops bootstrapping once any account exists", async () => {
      await seedUser("someone", "password-123");
      const response = await login(loginRequest({ username: "luan", password: "legacy-shared-password" }));
      expect(response.status).toBe(401);
      expect(await prisma.user.count()).toBe(1);
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
  });
});

describe("POST /api/auth/logout", () => {
  it("expires the session cookie", async () => {
    const response = await logout();
    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
  });
});
