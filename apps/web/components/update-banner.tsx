"use client";

import { useEffect, useState } from "react";

/** What the desktop shell (apps/desktop/src-tauri/src/updater.rs) reports. */
interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
}

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function tauri(): TauriInternals | undefined {
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
}

/**
 * Desktop app only (renders nothing in a normal browser): once the shell has
 * downloaded and verified a new version in the background, offer to install
 * it. "Later" hides it until the next launch.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<"ready" | "installing" | "failed">("ready");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = tauri();
    if (!api) return;
    // Ready before this page loaded?
    api
      .invoke("update_status")
      .then((info) => {
        if (info) setUpdate(info as UpdateInfo);
      })
      .catch(() => {});
    // Or finishes downloading while it's open.
    const onReady = (e: Event) => {
      setUpdate((e as CustomEvent<UpdateInfo>).detail);
      setDismissed(false);
    };
    window.addEventListener("tcgvault:update-ready", onReady);
    return () => window.removeEventListener("tcgvault:update-ready", onReady);
  }, []);

  if (!update || dismissed) return null;

  const install = async () => {
    setStatus("installing");
    try {
      // On success the app closes and the installer takes over (Windows) or it
      // restarts into the new version (macOS/Linux) — nothing more to do here.
      await tauri()?.invoke("install_update");
    } catch (err) {
      setStatus("failed");
      setError(String(err));
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border bg-canvas p-4 shadow-lg"
    >
      <p className="text-sm font-semibold">Update ready: TCG Vault {update.version}</p>
      <p className="mt-1 text-xs text-neutral-500">
        You have {update.currentVersion}. It&apos;s already downloaded — installing takes a few
        seconds and restarts the app.
      </p>
      {update.notes ? (
        <p className="mt-2 max-h-24 overflow-auto whitespace-pre-line text-xs text-neutral-600">
          {update.notes}
        </p>
      ) : null}
      {status === "failed" ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error ?? "Install failed."} Restart TCG Vault to try again.
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          disabled={status === "installing"}
          className="rounded px-3 py-1.5 text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
        >
          Later
        </button>
        <button
          type="button"
          onClick={install}
          disabled={status === "installing"}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-neutral-50 hover:bg-neutral-700 disabled:cursor-wait disabled:opacity-60"
        >
          {status === "installing" ? "Installing…" : "Restart & install"}
        </button>
      </div>
    </div>
  );
}
