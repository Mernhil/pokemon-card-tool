"use client";

import { useCallback, useEffect, useState } from "react";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
}

/** What the desktop shell (apps/desktop/src-tauri/src/updater.rs) reports. */
export interface UpdateOverview {
  currentVersion: string;
  /** Unix seconds of the last successful check this run. */
  lastCheckedAt: number | null;
  pending: UpdateInfo | null;
}

export type CheckResult = { status: "upToDate" } | { status: "ready"; info: UpdateInfo };

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

export function tauri(): TauriInternals | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
}

/** "just now" / "12 min ago" / "3 h ago" for a unix-seconds time. */
export function checkedAgo(unixSeconds: number, now = Date.now()): string {
  const mins = Math.floor((now - unixSeconds * 1000) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/**
 * Desktop app only: the version, when the shell last checked for an update, and whether one is
 * waiting. Refreshes when the shell finishes a check or a download. `overview` stays null in a
 * normal browser.
 */
export function useUpdateOverview() {
  const [overview, setOverview] = useState<UpdateOverview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    tauri()
      ?.invoke("update_overview")
      .then((o) => setOverview(o as UpdateOverview))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!tauri()) return;
    refresh();
    window.addEventListener("tcgvault:update-checked", refresh);
    window.addEventListener("tcgvault:update-ready", refresh);
    return () => {
      window.removeEventListener("tcgvault:update-checked", refresh);
      window.removeEventListener("tcgvault:update-ready", refresh);
    };
  }, [refresh]);

  /** Checks right now; resolves with the outcome (null if the check failed). */
  const check = useCallback(async (): Promise<CheckResult | null> => {
    setChecking(true);
    setError(null);
    try {
      const result = (await tauri()?.invoke("check_for_updates")) as CheckResult;
      refresh();
      return result;
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setChecking(false);
    }
  }, [refresh]);

  return { overview, checking, error, check, refresh };
}
