import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/currentUser";
import { getShop } from "@/lib/shops/registry";
import { isShopSlug, SHOP_COOKIE } from "@/lib/shops/slug";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

// The browser picks which shop the dashboard shows; the choice is remembered in a cookie.
export async function POST(request: NextRequest) {
  if (!(await getUserFromRequest(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const slug = body?.slug;
  if (!isShopSlug(slug) || !(await getShop(slug))) {
    return NextResponse.json({ error: "Không tìm thấy shop" }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SHOP_COOKIE, slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return response;
}
