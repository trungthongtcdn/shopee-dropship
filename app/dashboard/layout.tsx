import { redirect } from "next/navigation";
import { AppHeader } from "./AppHeader";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadOverdueWarnings } from "@/lib/cancellation/overdueWarnings";
import { currentShopSlug } from "@/lib/shops/context";
import { listShops } from "@/lib/shops/registry";
import { ShopMarker } from "@/lib/shops/ShopMarker";

// Queries the DB on every render, so it must never be prerendered at build
// time (see the note in app/layout.tsx).
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // middleware already proved the cookie is validly signed; this proves the
  // account it names still exists (a deleted account must not keep access).
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // The browser remembers its shop in a cookie; if that shop is gone, start over from
  // the first one.
  const [shops, slug] = [await listShops(), currentShopSlug()];
  if (!shops.some((shop) => shop.slug === slug)) redirect("/api/shops/reset");

  const warnings = await loadOverdueWarnings();

  return (
    <>
      <ShopMarker slug={slug} />
      <AppHeader
        overdueWarningCount={warnings.length}
        username={user.username}
        shops={shops.map((shop) => ({ slug: shop.slug, name: shop.name }))}
        currentSlug={slug}
      />
      {children}
    </>
  );
}
