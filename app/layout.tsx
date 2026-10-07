import { Be_Vietnam_Pro, Fira_Code } from "next/font/google";
import "./globals.css";

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

// Deliberately does no DB work and renders no app chrome: this layout also
// wraps /login (no header there) and /_not-found, which `next build`
// prerenders — a DB query here breaks the build wherever DATABASE_URL isn't
// available (it broke the zalo-poller image once). The header, the
// overdue-warning count and the "is this account still real" check live in
// app/dashboard/layout.tsx instead.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${beVietnamPro.variable} ${firaCode.variable}`}>
      <body>{children}</body>
    </html>
  );
}
