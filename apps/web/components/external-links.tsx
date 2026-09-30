"use client";

import { useEffect } from "react";

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Desktop app only: the webview swallows `target="_blank"` links, so links to other sites
 * (provider pages, TCGdex, ...) open in the default browser through the shell's
 * `open_external` command instead. In a normal browser this does nothing. Mounted once in the
 * root layout.
 */
export function ExternalLinks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const tauri = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals })
        .__TAURI_INTERNALS__;
      if (!tauri) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !/^https?:$/.test(a.protocol) || a.origin === window.location.origin) return;
      e.preventDefault();
      tauri.invoke("open_external", { url: a.href }).catch(() => {});
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
