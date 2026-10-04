"use client";

import {
  Award,
  BookOpen,
  ChartLine,
  Flag,
  Heart,
  Home,
  Layers,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import logo from "../assets/logo.png";
import type { Theme } from "../lib/theme";
import { SIDEBAR_COOKIE } from "../lib/ui-cookies";
import { SyncIndicator } from "./sync-indicator";
import { UpdateCheck } from "./update-check";
import { ThemeToggle } from "./theme-toggle";

export const NAV: Array<{ href: string; label: string; icon: LucideIcon; match?: RegExp }> = [
  { href: "/", label: "Home", icon: Home, match: /^\/$/ },
  {
    href: "/browse",
    label: "Browse",
    icon: Library,
    match: /^\/(browse|pokemon|yugioh|one-piece)/,
  },
  { href: "/search", label: "Search", icon: Search },
  { href: "/collection", label: "Collection", icon: Layers },
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/pokedex", label: "Pokédex", icon: Target },
  { href: "/goals", label: "Goals", icon: Flag },
  { href: "/wishlist", label: "Wishlist", icon: Heart },
  { href: "/binders", label: "Binders", icon: BookOpen },
  { href: "/dashboard", label: "Dashboard", icon: ChartLine },
  { href: "/grading", label: "Grading", icon: Award },
  { href: "/sync", label: "Sync", icon: RefreshCw },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** App navigation for the desktop window: logo, quick search, sections, theme. Collapsible. */
export function Sidebar({ initialCollapsed, theme }: { initialCollapsed: boolean; theme: Theme }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r md:flex bg-sidebar transition-[width] duration-300 ease-out ${
        collapsed ? "w-[68px]" : "w-60"
      }`}
    >
      <Link
        href="/"
        className={`flex items-center gap-2.5 px-4 pb-4 pt-5 ${collapsed ? "justify-center px-0" : ""}`}
        title="TCG Vault"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo.src} alt="" width={36} height={36} className="h-9 w-9 drop-shadow" />
        {collapsed ? null : (
          <span className="font-display text-lg font-semibold tracking-wide text-foil">
            TCG Vault
          </span>
        )}
      </Link>

      {collapsed ? null : (
        <form
          className="px-3 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q")?.toString().trim();
            router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
          }}
        >
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input
              name="q"
              placeholder="Search cards…"
              autoComplete="off"
              aria-label="Search cards"
              className="field w-full pl-8 text-sm"
            />
          </label>
        </form>
      )}

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {NAV.map((item) => {
          const active = item.match ? item.match.test(pathname) : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              className={`group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-0" : ""
              } ${
                active
                  ? "bg-accent-soft text-neutral-950"
                  : "text-neutral-600 hover:bg-surface-2 hover:text-neutral-900"
              }`}
            >
              {active ? (
                <span
                  className="absolute left-0 top-2 h-6 w-[3px] rounded-r bg-accent"
                  aria-hidden
                />
              ) : null}
              <item.icon
                className={`h-[18px] w-[18px] shrink-0 ${active ? "text-accent" : ""}`}
                strokeWidth={1.8}
              />
              {collapsed ? null : item.label}
            </Link>
          );
        })}
      </nav>

      <SyncIndicator collapsed={collapsed} />
      <UpdateCheck collapsed={collapsed} />

      <div
        className={`flex items-center gap-2 border-t p-3 ${collapsed ? "flex-col" : "justify-between"}`}
      >
        {collapsed ? (
          <ThemeToggle initial={theme} compact />
        ) : (
          <div className="w-28">
            <ThemeToggle initial={theme} />
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="grid h-9 w-9 place-items-center rounded-lg text-neutral-500 hover:bg-surface-2 hover:text-neutral-900"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
