import { sharedPrisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { formatDateVN } from "@/lib/format/datetime";
import { listShops } from "@/lib/shops/registry";
import { AccountsManager } from "./AccountsManager";
import { ShopNames } from "./ShopNames";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const [me, users, shops] = await Promise.all([
    getCurrentUser(),
    sharedPrisma.user.findMany({ orderBy: { id: "asc" }, select: { id: true, username: true, createdAt: true } }),
    listShops(),
  ]);

  return (
    <main className="page">
      <ShopNames shops={shops.map((shop) => ({ id: shop.id, slug: shop.slug, name: shop.name }))} />
      <h1>Quản lý tài khoản</h1>
      <AccountsManager
        currentUserId={me?.id ?? null}
        accounts={users.map((user) => ({ id: user.id, username: user.username, createdLabel: formatDateVN(user.createdAt) }))}
      />
    </main>
  );
}
