import { NextRequest, NextResponse } from "next/server";
import { SHOP_COOKIE } from "@/lib/shops/slug";

// The dashboard sends the browser here when its remembered shop no longer exists:
// forget it and start over from the first shop.
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.cookies.delete(SHOP_COOKIE);
  return response;
}
