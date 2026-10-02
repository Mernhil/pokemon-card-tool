"use client";

import { Ellipsis, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Theme } from "../lib/theme";
import { NAV } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

const PRIMARY = ["/", "/browse", "/search", "/collection"];

/** Phone navigation (below `md`): a bottom tab bar with the main sections and a "More" sheet. */
export function MobileNav({ theme }: { theme: Theme }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  const isActive = (item: (typeof NAV)[number]) =>
    item.match ? item.match.test(pathname) : pathname.startsWith(item.href);
  const primary = NAV.filter((item) => PRIMARY.includes(item.href));
  const more = NAV.filter((item) => !PRIMARY.includes(item.href));
  const moreActive = more.some(isActive);

  return (
    <div className="md:hidden">
      {open ? (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] rounded-t-2xl border-t bg-sidebar p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-3 gap-2">
              {more.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center gap-1 rounded-lg py-3 text-xs font-medium ${
                    isActive(item) ? "bg-accent-soft text-accent" : "text-neutral-600"
                  }`}
                >
                  <item.icon className="h-5 w-5" strokeWidth={1.8} />
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="mt-3 flex justify-center border-t pt-3">
              <div className="w-40">
                <ThemeToggle initial={theme} />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 flex border-t bg-sidebar pb-[env(safe-area-inset-bottom)]"
      >
        {primary.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                active ? "text-accent" : "text-neutral-500"
              }`}
            >
              <item.icon className="h-5 w-5" strokeWidth={1.8} />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            open || moreActive ? "text-accent" : "text-neutral-500"
          }`}
        >
          {open ? <X className="h-5 w-5" /> : <Ellipsis className="h-5 w-5" />}
          More
        </button>
      </nav>
    </div>
  );
}
