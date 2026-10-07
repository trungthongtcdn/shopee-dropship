import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

// Deliberately not applied to /api/sync/webhook — Apps Script authenticates
// there with its own X-Sync-Secret header, checked inside the route handler —
// nor to /login and /api/auth/*, which have to be reachable while logged out.
export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/api/reconcile/:path*",
    "/api/orders/:path*",
    "/api/zalo/:path*",
    "/api/report/:path*",
    "/api/don-huy/:path*",
    "/api/accounts/:path*",
    "/api/waybills/:path*",
  ],
};

// Edge runtime: can only check the cookie's signature and expiry, not that
// the account still exists (no Prisma here). That second check lives in
// app/dashboard/layout.tsx and the accounts API — see lib/auth/currentUser.ts.
export async function middleware(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, getSessionSecret());
  if (session) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Must be an absolute URL: a hand-built relative `Location` header makes
  // Next's middleware adapter throw "TypeError: Invalid URL" (found by actually
  // loading a protected page — unit tests never run that adapter). Caddy's
  // plain reverse_proxy keeps the public Host header, so request.url is right.
  const destination = pathname + search;
  const location = destination === "/" ? "/login" : `/login?next=${encodeURIComponent(destination)}`;
  return NextResponse.redirect(new URL(location, request.url));
}
