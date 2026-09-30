"use client";

import { useEffect } from "react";
import { useToast } from "./ui/toast";

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
  const toast = useToast();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const tauri = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals })
        .__TAURI_INTERNALS__;
      if (!tauri) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !/^https?:$/.test(a.protocol) || a.origin === window.location.origin) return;
      e.preventDefault();
      const url = a.href;
      tauri.invoke("open_external", { url }).catch((err) => {
        // Never leave the click doing nothing: keep the link and say what went wrong.
        navigator.clipboard?.writeText(url).catch(() => {});
        toast("error", `Couldn't open the browser (${String(err)}). Link copied.`);
      });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [toast]);
  return null;
}
