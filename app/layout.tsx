import { Be_Vietnam_Pro, Fira_Code } from "next/font/google";
import "./globals.css";
import { AppHeader } from "./dashboard/AppHeader";
import { loadOverdueWarnings } from "@/lib/cancellation/overdueWarnings";

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fira-sans",
  display: "swap",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-fira-code",
  display: "swap",
});

// Forces every route (including /_not-found and "/") to render at request
// time instead of being statically prerendered at build time — the layout
// now queries the DB on every render (loadOverdueWarnings), and `next build`
// has no DATABASE_URL available in every build context (confirmed: it broke
// the zalo-poller image's build, which runs `next build` too but without a
// live DB to query against).
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const warnings = await loadOverdueWarnings();

  return (
    <html lang="vi" className={`${beVietnamPro.variable} ${firaCode.variable}`}>
      <body>
        <AppHeader overdueWarningCount={warnings.length} />
        {children}
      </body>
    </html>
  );
}
