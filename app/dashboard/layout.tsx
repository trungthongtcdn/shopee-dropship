import { redirect } from "next/navigation";
import { AppHeader } from "./AppHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadOverdueWarnings } from "@/lib/cancellation/overdueWarnings";

// Queries the DB on every render, so it must never be prerendered at build
// time (see the note in app/layout.tsx).
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // middleware already proved the cookie is validly signed; this proves the
  // account it names still exists (a deleted account must not keep access).
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const warnings = await loadOverdueWarnings();

  return (
    <>
      <AppHeader overdueWarningCount={warnings.length} username={user.username} />
      {children}
    </>
  );
}
