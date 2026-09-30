"use client";

import { Download, RefreshCw } from "lucide-react";
import { checkedAgo, useUpdateOverview } from "../lib/use-update-overview";
import { useToast } from "./ui/toast";

/**
 * Desktop app only: "Check for updates" at the foot of the sidebar, with the current version,
 * when it last checked, and a dot while a downloaded update is waiting (clicking then brings the
 * install prompt back).
 */
export function UpdateCheck({ collapsed }: { collapsed: boolean }) {
  const { overview, checking, check } = useUpdateOverview();
  const toast = useToast();
  if (!overview) return null;
  const pending = overview.pending;

  const onClick = async () => {
    if (pending) {
      window.dispatchEvent(new CustomEvent("tcgvault:show-update"));
      return;
    }
    const result = await check();
    if (!result) toast("error", "Couldn't check for updates. See Settings for details.");
    else if (result.status === "upToDate") toast("success", "You're up to date.");
  };

  const label = pending
    ? `Update ${pending.version} ready`
    : checking
      ? "Checking…"
      : "Check for updates";
  const Icon = pending ? Download : RefreshCw;
  const detail = `v${overview.currentVersion}${
    overview.lastCheckedAt ? ` · checked ${checkedAgo(overview.lastCheckedAt)}` : ""
  }`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={checking}
      title={collapsed ? `${label} (${detail})` : undefined}
      className={`relative mx-3 mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-left text-neutral-600 transition-colors hover:bg-surface-2 hover:text-neutral-900 disabled:opacity-60 ${
        collapsed ? "justify-center px-0" : ""
      }`}
    >
      <span className="relative shrink-0">
        <Icon className={`h-[18px] w-[18px] ${checking ? "animate-spin" : ""}`} strokeWidth={1.8} />
        {pending ? (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" aria-hidden />
        ) : null}
      </span>
      {collapsed ? null : (
        <span className="min-w-0">
          <span className={`block text-sm font-medium ${pending ? "text-accent" : ""}`}>
            {label}
          </span>
          <span className="block truncate text-[11px] text-neutral-500">{detail}</span>
        </span>
      )}
    </button>
  );
}
