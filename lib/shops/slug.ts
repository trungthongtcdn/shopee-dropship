// A shop's identity. The first shop is the data the app already held before it
// had shops, and stays in Postgres' `public` schema; every later shop gets a
// schema of its own named after its slug. The slug is also what the `shop`
// cookie and the `x-shop` header carry, so it is validated strictly: it ends up
// in connection strings and in CREATE SCHEMA.

export const PRIMARY_SLUG = "shop_1";
export const SHOP_COOKIE = "shop";
export const SHOP_HEADER = "x-shop";

const SLUG_PATTERN = /^shop_[1-9][0-9]{0,2}$/;

export function isShopSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_PATTERN.test(value);
}

export function schemaFor(slug: string): string {
  return slug === PRIMARY_SLUG ? "public" : slug;
}

// The first shop connects with the url as configured (its tables are where they
// always were); any other shop adds `schema=<slug>`, which Prisma turns into both
// the search path and the qualifier on every table it queries.
export function shopDatabaseUrl(baseUrl: string, slug: string): string {
  if (slug === PRIMARY_SLUG) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set("schema", slug);
  return url.toString();
}
