import Link from "next/link";
import { Fira_Sans, Fira_Code } from "next/font/google";
import "./globals.css";

const firaSans = Fira_Sans({
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${firaSans.variable} ${firaCode.variable}`}>
      <body>
        <header className="app-header">
          <div className="app-header-inner">
            <span className="app-brand">Shopee Dropship</span>
            <nav className="app-nav">
              <Link className="nav-link" href="/dashboard/orders">
                Orders
              </Link>
              <Link className="nav-link" href="/dashboard/reconciliation">
                Reconciliation
              </Link>
              <Link className="nav-link" href="/dashboard/report">
                Report (LUÂN CẦN)
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
