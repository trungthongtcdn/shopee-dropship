import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { safeNextPath } from "@/lib/auth/redirect";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: { next?: string | string[] } }) {
  const next = safeNextPath(searchParams.next);

  // Already signed in (and the account still exists) — nothing to do here.
  if (await getCurrentUser()) redirect(next);

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Shopee Dropship</h1>
        <p className="cell-muted" style={{ marginTop: 0 }}>
          Đăng nhập để tiếp tục
        </p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
