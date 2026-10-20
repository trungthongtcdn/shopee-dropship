import { PrismaClient } from "@prisma/client";
import { currentShopSlug } from "@/lib/shops/context";
import { isShopSlug, PRIMARY_SLUG, shopDatabaseUrl } from "@/lib/shops/slug";

// One PrismaClient per shop, each connected to that shop's schema (see
// lib/shops/slug.ts). Kept on globalThis so dev hot reloads don't pile up pools.
const globalForShops = globalThis as unknown as { shopClients?: Map<string, PrismaClient> };

export function clientFor(slug: string): PrismaClient {
  if (!isShopSlug(slug)) throw new Error(`Invalid shop slug: ${slug}`);
  const clients = (globalForShops.shopClients ??= new Map());
  let client = clients.get(slug);
  if (!client) {
    const baseUrl = process.env.DATABASE_URL;
    client =
      slug === PRIMARY_SLUG || !baseUrl
        ? new PrismaClient()
        : new PrismaClient({ datasourceUrl: shopDatabaseUrl(baseUrl, slug) });
    clients.set(slug, client);
  }
  return client;
}

// Drops the cached client of a shop whose schema is being removed or rebuilt.
export async function forgetClient(slug: string): Promise<void> {
  const client = globalForShops.shopClients?.get(slug);
  globalForShops.shopClients?.delete(slug);
  await client?.$disconnect();
}

// Tables every shop shares (accounts, the list of shops) live in `public` only.
// They are reached through sharedPrisma; the shop-scoped `prisma` below hides them
// from the type so a stray `prisma.user` can't silently read an empty copy.
export const sharedPrisma: PrismaClient = clientFor(PRIMARY_SLUG);

export type ShopClient = Omit<PrismaClient, "user" | "shop">;

// The client of whichever shop the current code works for — see currentShopSlug.
export const prisma: ShopClient = new Proxy({} as ShopClient, {
  get(_target, property) {
    const client = clientFor(currentShopSlug());
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
