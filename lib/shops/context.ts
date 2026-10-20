import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import { isShopSlug, PRIMARY_SLUG, SHOP_COOKIE } from "./slug";

const scope = new AsyncLocalStorage<string>();

// Runs `fn` — and everything it awaits — against one shop. The sync webhook, the
// Zalo poller and the route guard use it; pages get their shop from the cookie.
export function runWithShop<T>(slug: string, fn: () => T): T {
  if (!isShopSlug(slug)) throw new Error(`Invalid shop slug: ${slug}`);
  return scope.run(slug, fn);
}

// The shop the code running right now works for.
//   1. an explicit runWithShop scope;
//   2. inside a web request: the `shop` cookie, or the first shop when the browser
//      hasn't picked one (or sent something that isn't a shop);
//   3. anywhere else (scripts, tests): the first shop in dev/test — the 600+ tests
//      predate shops — but never in production, where guessing would mix shops up.
export function currentShopSlug(): string {
  const scoped = scope.getStore();
  if (scoped) return scoped;

  let cookie: string | null | undefined;
  try {
    cookie = cookies().get(SHOP_COOKIE)?.value ?? null;
  } catch {
    cookie = undefined; // not inside a Next request
  }
  if (cookie !== undefined) return isShopSlug(cookie) ? cookie : PRIMARY_SLUG;

  if (process.env.NODE_ENV === "production") throw new Error("No shop in scope");
  return PRIMARY_SLUG;
}
