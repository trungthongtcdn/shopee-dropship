import Link from "next/link";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <nav>
            <Link href="/dashboard/orders">Orders</Link>
            {" | "}
            <Link href="/dashboard/reconciliation">Reconciliation</Link>
            {" | "}
            <Link href="/dashboard/report">Report (LUÂN CẦN)</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
