import { NextRequest, NextResponse } from "next/server";
import { runWithShop } from "./context";
import { getShop, type ShopInfo } from "./registry";
import { isShopSlug, PRIMARY_SLUG, SHOP_COOKIE, SHOP_HEADER } from "./slug";

// What an API route checks before it touches a shop's data.
//   "header"  a write sent from a page: the page says which shop it was rendered for
//             (x-shop, added by shopFetch) and the server refuses if the browser's
//             current shop is another one — the stale-tab case, where tab A still shows
//             shop A after tab B switched the cookie to shop B. Order #5 of shop A is
//             not order #5 of shop B, so such a write must never be applied.
//   "query"   a download link naming a row by number: same check on ?shop=.
//   "none"    just run in the shop of the request.
export type ShopCheck = "header" | "query" | "none";

export type ShopRouteHandler<C> = (request: NextRequest, context: C, shop: ShopInfo) => Promise<Response> | Response;

const STALE_TAB_MESSAGE = "Tab này đang ở shop khác với shop đang chọn. Hãy tải lại trang rồi làm lại.";

function refuse(code: string, error: string) {
  return NextResponse.json({ error, code }, { status: 409 });
}

export function withShop<C = unknown>(handler: ShopRouteHandler<C>, options: { check?: ShopCheck } = {}) {
  const check = options.check ?? "none";
  return async (request: NextRequest, context?: C): Promise<Response> => {
    const cookie = request.cookies.get(SHOP_COOKIE)?.value;
    const slug = isShopSlug(cookie) ? cookie : PRIMARY_SLUG;
    const shop = await getShop(slug);
    if (!shop) return refuse("shop_unknown", "Shop này không còn nữa. Hãy tải lại trang.");

    if (check !== "none") {
      const declared = check === "header" ? request.headers.get(SHOP_HEADER) : request.nextUrl.searchParams.get("shop");
      if (declared === null) {
        // Pages always say which shop they are; only hand-made calls (tests, curl)
        // omit it, and production doesn't take those on faith.
        if (process.env.NODE_ENV === "production") return refuse("shop_missing", STALE_TAB_MESSAGE);
      } else if (declared !== slug) {
        return refuse("shop_mismatch", STALE_TAB_MESSAGE);
      }
    }

    return runWithShop(slug, () => handler(request, context as C, shop));
  };
}
