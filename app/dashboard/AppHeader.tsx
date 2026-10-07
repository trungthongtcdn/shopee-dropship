"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const NAV_GROUPS: { href: string; label: string }[][] = [
  [
    { href: "/dashboard/report", label: "Báo cáo đối soát" },
    { href: "/dashboard/orders", label: "Đơn hàng" },
    { href: "/dashboard/hoan-huy", label: "Đơn hoàn huỷ" },
  ],
  [
    { href: "/dashboard/dong-don", label: "Đóng đơn" },
    { href: "/dashboard/don-huy", label: "Nhận đơn huỷ" },
  ],
  [{ href: "/dashboard/reconciliation", label: "Đối soát thanh toán" }],
];

export function AppHeader({ overdueWarningCount = 0, username }: { overdueWarningCount?: number; username: string }) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const lastScrollY = useRef(0);
  const menuRef = useRef<HTMLDetailsElement>(null);

  function closeMenu() {
    if (menuRef.current) menuRef.current.open = false;
  }

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) closeMenu();
    }
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, []);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // Hard navigation, not router.push: drops every cached RSC payload of the
    // account that just logged out.
    window.location.href = "/login";
  }

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      const goingDown = y > lastScrollY.current;
      const shouldHide = goingDown && y > 60;
      setHidden(shouldHide);
      lastScrollY.current = y;
      document.documentElement.style.setProperty("--header-offset", shouldHide ? "0px" : "60px");
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`app-header${hidden ? " app-header-hidden" : ""}`}>
      <div className="app-header-inner">
        <span className="app-brand">Shopee Dropship</span>
        <nav className="app-nav">
          {NAV_GROUPS.map((group, i) => (
            <span className="app-nav-group" key={i}>
              {group.map((item) => (
                <Link
                  key={item.href}
                  className={`nav-link${pathname === item.href ? " active" : ""}`}
                  href={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </span>
          ))}
        </nav>
        {overdueWarningCount > 0 ? (
          <Link href="/dashboard/hoan-huy" className="badge badge-danger" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
            ⚠️ {overdueWarningCount} đơn cảnh báo quá hạn
          </Link>
        ) : null}
        {/* One compact dropdown instead of a name link + a button: the header is a
            fixed 60px row, and with the overdue-warning badge showing there is
            no horizontal room left below ~1400px for anything wider. */}
        <details ref={menuRef} className="user-menu">
          <summary className={`nav-link${pathname === "/dashboard/accounts" ? " active" : ""}`}>{username}</summary>
          <div className="user-menu-panel">
            <Link href="/dashboard/accounts" className="filter-dropdown-item" onClick={() => closeMenu()}>
              Quản lý tài khoản
            </Link>
            <button type="button" className="filter-dropdown-item user-menu-button" onClick={logout} disabled={loggingOut}>
              Đăng xuất
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}
