"use client";

import { useEffect } from "react";
import {
  createOnceGate,
  historyDirectionForMouseButton,
} from "@tcg-vault/shared/src/scroll-restore";

/**
 * Mouse side buttons (3 = Back, 4 = Forward) as browser history navigation.
 *
 * Some webviews navigate on them natively and some ignore them. Instead of
 * guessing, we handle them ourselves everywhere and cancel the default on
 * every event of the press (mousedown, mouseup, auxclick, click), so a
 * webview that would also navigate never does it a second time; the once-gate
 * covers a press seen by more than one of our own listeners.
 * Mounted once in the root layout.
 */
export function HistoryNavigation() {
  useEffect(() => {
    const gate = createOnceGate(300);
    const swallow = (e: MouseEvent) => {
      if (historyDirectionForMouseButton(e.button) === null) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onMouseDown = (e: MouseEvent) => {
      const dir = historyDirectionForMouseButton(e.button);
      if (!dir) return;
      swallow(e);
      if (gate()) (dir === "back" ? history.back : history.forward).call(history);
    };
    const opts = { capture: true } as const;
    window.addEventListener("mousedown", onMouseDown, opts);
    window.addEventListener("mouseup", swallow, opts);
    window.addEventListener("auxclick", swallow, opts);
    window.addEventListener("click", swallow, opts);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, opts);
      window.removeEventListener("mouseup", swallow, opts);
      window.removeEventListener("auxclick", swallow, opts);
      window.removeEventListener("click", swallow, opts);
    };
  }, []);
  return null;
}
