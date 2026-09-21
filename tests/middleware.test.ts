import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function requestWithAuth(header?: string) {
  return new NextRequest("http://localhost/dashboard/orders", {
    headers: header ? { authorization: header } : {},
  });
}

function basicAuthHeader(user: string, password: string) {
  return "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
}

describe("middleware", () => {
  const originalUser = process.env.DASHBOARD_USER;
  const originalPassword = process.env.DASHBOARD_PASSWORD;

  afterEach(() => {
    process.env.DASHBOARD_USER = originalUser;
    process.env.DASHBOARD_PASSWORD = originalPassword;
  });

  it("allows the request through when no credentials are configured (local dev)", () => {
    delete process.env.DASHBOARD_USER;
    delete process.env.DASHBOARD_PASSWORD;

    const response = middleware(requestWithAuth());
    expect(response.status).toBe(200);
  });

  describe("with credentials configured", () => {
    beforeEach(() => {
      process.env.DASHBOARD_USER = "luan";
      process.env.DASHBOARD_PASSWORD = "s3cret";
    });

    it("rejects a request with no Authorization header", () => {
      const response = middleware(requestWithAuth());
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
    });

    it("rejects wrong credentials", () => {
      const response = middleware(requestWithAuth(basicAuthHeader("luan", "wrong-password")));
      expect(response.status).toBe(401);
    });

    it("rejects a malformed Authorization header", () => {
      const response = middleware(requestWithAuth("Basic not-valid-base64-colon-pair"));
      expect(response.status).toBe(401);
    });

    it("allows the request through with correct credentials", () => {
      const response = middleware(requestWithAuth(basicAuthHeader("luan", "s3cret")));
      expect(response.status).toBe(200);
    });
  });
});
