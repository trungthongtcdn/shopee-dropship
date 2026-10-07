import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { formatDateVN } from "@/lib/format/datetime";
import { AccountsManager } from "./AccountsManager";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const [me, users] = await Promise.all([
    getCurrentUser(),
    prisma.user.findMany({ orderBy: { id: "asc" }, select: { id: true, username: true, createdAt: true } }),
  ]);

  return (
    <main className="page">
      <h1>Quản lý tài khoản</h1>
      <AccountsManager
        currentUserId={me?.id ?? null}
        accounts={users.map((user) => ({ id: user.id, username: user.username, createdLabel: formatDateVN(user.createdAt) }))}
      />
    </main>
  );
}
