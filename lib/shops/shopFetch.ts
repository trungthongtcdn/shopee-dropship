import { SHOP_HEADER } from "./slug";

// fetch() for the browser that tells the server which shop this page was rendered
// for (see withShop). The slug is read from the marker the dashboard layout renders.
export function shopFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const slug = document.querySelector<HTMLElement>("[data-shop-slug]")?.dataset.shopSlug;
  const headers = new Headers(init.headers);
  if (slug) headers.set(SHOP_HEADER, slug);
  return fetch(input, { ...init, headers });
}

// The message to show when the server refused a request because this tab belongs to
// another shop than the browser's current one (see withShop); null for any other response.
export async function shopRefusal(response: Response): Promise<string | null> {
  if (response.status !== 409) return null;
  const body = await response.clone().json().catch(() => null);
  return typeof body?.code === "string" && body.code.startsWith("shop_") ? String(body.error) : null;
}
