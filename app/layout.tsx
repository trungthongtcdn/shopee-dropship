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
