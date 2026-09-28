"use client";

import { useState } from "react";
import { Button } from "./ui/button";

interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
}

type CheckResult = { status: "upToDate" } | { status: "ready"; info: UpdateInfo };

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function tauri(): TauriInternals | undefined {
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
}

/**
 * Desktop app only (renders nothing in a normal browser): runs an update
 * check right away instead of waiting for the background loop (every 6h,
 * and 5s after launch — see apps/desktop/src-tauri/src/updater.rs). A found
 * update is downloaded and verified the same way, and shows up via the
 * usual update-banner once ready.
 */
export function CheckForUpdatesButton() {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "done"; result: CheckResult }
    | { kind: "error"; error: string }
  >({ kind: "idle" });

  if (typeof window === "undefined" || !tauri()) return null;

  const check = async () => {
    setState({ kind: "checking" });
    try {
      const result = (await tauri()?.invoke("check_for_updates")) as CheckResult;
      setState({ kind: "done", result });
    } catch (err) {
      setState({ kind: "error", error: String(err) });
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" disabled={state.kind === "checking"} onClick={check}>
        {state.kind === "checking" ? "Checking…" : "Check for updates"}
      </Button>
      {state.kind === "done" && state.result.status === "upToDate" ? (
        <p className="text-xs text-neutral-500">You&apos;re up to date.</p>
      ) : null}
      {state.kind === "done" && state.result.status === "ready" ? (
        <p className="text-xs text-neutral-500">
          TCG Vault {state.result.info.version} is downloaded and ready — install it from the prompt
          in the corner.
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="text-xs text-red-600 dark:text-red-400">Check failed: {state.error}</p>
      ) : null}
    </div>
  );
}
