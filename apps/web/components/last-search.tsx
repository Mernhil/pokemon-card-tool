"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const KEY = "tcg-vault:last-search";

/** Remembers the last /search URL (query and filters) so a card page can link back to it. */
function Recorder() {
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    if (pathname !== "/search") return;
    const qs = params.toString();
    try {
      sessionStorage.setItem(KEY, qs ? `/search?${qs}` : "/search");
    } catch {
      // Storage unavailable — the back link just won't show.
    }
  }, [pathname, params]);
  return null;
}

export function LastSearchRecorder() {
  return (
    <Suspense fallback={null}>
      <Recorder />
    </Suspense>
  );
}

/** "← Search: starmie" — back to the search the user came from, if there was one. */
export function BackToSearch() {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    try {
      setHref(sessionStorage.getItem(KEY));
    } catch {
      setHref(null);
    }
  }, []);
  if (!href) return null;
  const q = new URLSearchParams(href.split("?")[1] ?? "").get("q");
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em] text-neutral-500 hover:text-neutral-900"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {q ? `Search: ${q}` : "Search results"}
    </Link>
  );
}
