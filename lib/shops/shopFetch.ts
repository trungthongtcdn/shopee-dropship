import { SHOP_HEADER } from "./slug";

// fetch() for the browser that tells the server which shop this page was rendered
// for (see withShop). The slug is read from the marker the dashboard layout renders.
export function shopFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const slug = document.querySelector<HTMLElement>("[data-shop-slug]")?.dataset.shopSlug;
  const headers = new Headers(init.headers);
  if (slug) headers.set(SHOP_HEADER, slug);
  return fetch(input, { ...init, headers });
}
