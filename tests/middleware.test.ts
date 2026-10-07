import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config } from "@/middleware";
import { signSession, SESSION_COOKIE } from "@/lib/auth/session";

const SECRET = "middleware-test-secret-middleware-test";

function requestTo(path: string, token?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
}

describe("middleware", () => {
  const originalSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  });

  it("redirects a page request with no session cookie to /login, remembering where it was going", async () => {
    const response = await middleware(requestTo("/dashboard/orders?q=abc"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login?next=%2Fdashboard%2Forders%3Fq%3Dabc");
  });

  it("redirects the bare root to /login without a next param", async () => {
    const response = await middleware(requestTo("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("answers an API request with no session cookie with 401 JSON, not a redirect", async () => {
    const response = await middleware(requestTo("/api/orders/1"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });

  it("rejects a cookie signed with the wrong secret", async () => {
    const forged = await signSession(1, "some-other-secret-some-other-secret");
    const response = await middleware(requestTo("/dashboard/report", forged));
    expect(response.status).toBe(307);
  });

  it("rejects a garbage cookie", async () => {
    const response = await middleware(requestTo("/api/report/export", "not-a-token"));
    expect(response.status).toBe(401);
  });

  it("lets a request with a valid session cookie through", async () => {
    const token = await signSession(7, SECRET);
    const response = await middleware(requestTo("/dashboard/orders", token));
    expect(response.status).toBe(200);
  });

  it("covers the accounts API but not /login or /api/auth/*", () => {
    const matchers = config.matcher as string[];
    expect(matchers).toContain("/api/accounts/:path*");
    expect(matchers.some((m) => m.startsWith("/login") || m.startsWith("/api/auth"))).toBe(false);
  });
});

describe("middleware in production without SESSION_SECRET", () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
  });

  it("fails closed even for a token signed with the dev fallback secret", async () => {
    const devToken = await signSession(1, "dev-only-insecure-session-secret");
    delete process.env.SESSION_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    const response = await middleware(requestTo("/dashboard/report", devToken));
    expect(response.status).toBe(307);
  });
});
