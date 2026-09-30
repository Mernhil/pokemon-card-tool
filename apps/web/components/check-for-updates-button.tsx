"use client";

import { useState } from "react";
import { checkedAgo, useUpdateOverview, type CheckResult } from "../lib/use-update-overview";
import { Button } from "./ui/button";

/**
 * Desktop app only (renders nothing in a normal browser): runs an update
 * check right away instead of waiting for the background loop (on launch and
 * then every 6 hours, or within a minute of waking from sleep — see
 * apps/desktop/src-tauri/src/updater.rs). A found update is downloaded and
 * verified the same way, and shows up via the usual update-banner once ready.
 */
export function CheckForUpdatesButton() {
  const { overview, checking, error, check } = useUpdateOverview();
  const [result, setResult] = useState<CheckResult | null>(null);
  if (!overview) return null;

  const readyVersion =
    overview.pending?.version ?? (result?.status === "ready" ? result.info.version : null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={checking}
          onClick={async () => setResult(await check())}
        >
          {checking ? "Checking…" : "Check for updates"}
        </Button>
        {result?.status === "upToDate" && !readyVersion ? (
          <p className="text-xs text-neutral-500">You&apos;re up to date.</p>
        ) : null}
        {readyVersion ? (
          <p className="text-xs text-neutral-500">
            TCG Vault {readyVersion} is downloaded and ready — install it from the prompt in the
            corner.
          </p>
        ) : null}
        {error ? (
          <p className="text-xs text-red-600 dark:text-red-400">Check failed: {error}</p>
        ) : null}
      </div>
      <p className="text-xs text-neutral-500">
        Version {overview.currentVersion}
        {overview.lastCheckedAt ? ` · last checked ${checkedAgo(overview.lastCheckedAt)}` : ""}
      </p>
    </div>
  );
}
