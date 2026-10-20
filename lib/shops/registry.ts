import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { sharedPrisma } from "@/lib/db";
import { PRIMARY_SLUG } from "./slug";

// The list of shops the site serves (the shared `shops` table).

export interface ShopInfo {
  id: number;
  slug: string;
  name: string;
  skuSheetUrl: string | null;
}

export const MAX_SHOP_NAME_LENGTH = 40;

const select = { id: true, slug: true, name: true, skuSheetUrl: true } as const;

export function listShops(): Promise<ShopInfo[]> {
  return sharedPrisma.shop.findMany({ orderBy: { id: "asc" }, select });
}

export function getShop(slug: string): Promise<ShopInfo | null> {
  return sharedPrisma.shop.findUnique({ where: { slug }, select });
}

export function normalizeShopName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Tên shop không hợp lệ" };
  const name = raw.replace(/\s+/g, " ").trim();
  if (name === "") return { ok: false, error: "Tên shop không được để trống" };
  if (name.length > MAX_SHOP_NAME_LENGTH) {
    return { ok: false, error: `Tên shop tối đa ${MAX_SHOP_NAME_LENGTH} ký tự` };
  }
  return { ok: true, name };
}

export type RenameResult =
  | { ok: true; shop: ShopInfo }
  | { ok: false; status: 400 | 404 | 409; error: string };

export async function renameShop(id: number, raw: unknown): Promise<RenameResult> {
  const normalized = normalizeShopName(raw);
  if (!normalized.ok) return { ok: false, status: 400, error: normalized.error };

  const shops = await listShops();
  if (!shops.some((shop) => shop.id === id)) return { ok: false, status: 404, error: "Không tìm thấy shop" };
  const wanted = normalized.name.toLowerCase();
  if (shops.some((shop) => shop.id !== id && shop.name.toLowerCase() === wanted)) {
    return { ok: false, status: 409, error: "Đã có shop khác tên này" };
  }

  try {
    const shop = await sharedPrisma.shop.update({ where: { id }, data: { name: normalized.name }, select });
    return { ok: true, shop };
  } catch (error) {
    // Lost a race with another rename to the same name: the database's unique index on
    // lower(name) is what actually guarantees it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, status: 409, error: "Đã có shop khác tên này" };
    }
    throw error;
  }
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function generateSecret(): string {
  return randomBytes(24).toString("hex");
}

function sameSecret(a: string, b: string): boolean {
  // Digests have equal length, so the comparison takes the same time whatever differs.
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

// The shop an Apps Script request belongs to, told apart by the secret it sends.
// The first shop keeps the SYNC_WEBHOOK_SECRET it has always had; the others have
// theirs stored as a hash. A missing or empty secret matches nothing.
export async function shopForSecret(secret: string | null): Promise<ShopInfo | null> {
  if (!secret) return null;
  const envSecret = process.env.SYNC_WEBHOOK_SECRET;
  if (envSecret && sameSecret(secret, envSecret)) return getShop(PRIMARY_SLUG);
  return sharedPrisma.shop.findUnique({ where: { secretHash: hashSecret(secret) }, select });
}
