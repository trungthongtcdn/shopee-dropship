import { NextRequest, NextResponse } from "next/server";

// Deliberately not applied to /api/sync/webhook — Apps Script authenticates
// there with its own X-Sync-Secret header, checked inside the route handler.
export const config = {
  matcher: ["/", "/dashboard/:path*", "/api/reconcile/:path*", "/api/orders/:path*", "/api/zalo/:path*"],
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Shopee Dropship Reconciliation"' },
  });
}

export function middleware(request: NextRequest) {
  const expectedUser = process.env.DASHBOARD_USER;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;

  // No credentials configured — fail open in local dev so `npm run dev`
  // keeps working without extra setup, but this must always be set in any
  // deployed environment (see DEPLOY_VPS.md / README).
  if (!expectedUser || !expectedPassword) {
    return NextResponse.next();
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) {
    return unauthorized();
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    return unauthorized();
  }

  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  if (!timingSafeEqual(user, expectedUser) || !timingSafeEqual(password, expectedPassword)) {
    return unauthorized();
  }

  return NextResponse.next();
}
