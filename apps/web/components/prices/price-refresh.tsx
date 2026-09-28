"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { pricesUpdatingAction, refreshPricesAction } from "../../app/[game]/[set]/[number]/actions";
import { Button } from "../ui/button";

/**
 * "Refresh prices" + a subtle "Updating…" while a background refresh for
 * this card is queued/running. Polls the DB (never a provider), and
 * refreshes the page's server data once the update lands.
 */
export function PriceRefresh({
  variantIds,
  game,
  initiallyUpdating,
}: {
  variantIds: string[];
  game: string;
  initiallyUpdating: boolean;
}) {
  const router = useRouter();
  const [updating, setUpdating] = useState(initiallyUpdating);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!updating) return;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      const still = await pricesUpdatingAction(variantIds).catch(() => true);
      if (stopped) return;
      // Give up polling after 5 minutes; the background job carries on regardless.
      if (!still || Date.now() - started > 5 * 60_000) {
        setUpdating(false);
        startTransition(() => router.refresh());
      } else {
        setTimeout(tick, 3_000);
      }
    };
    const timer = setTimeout(tick, 3_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [updating, variantIds, router]);

  return (
    <div className="flex items-center gap-3">
      {updating ? (
        <span className="flex items-center gap-1.5 text-xs text-neutral-500" aria-live="polite">
          <RefreshCw className="h-3 w-3 animate-spin" /> Updating…
        </span>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        disabled={updating}
        onClick={async () => {
          setUpdating(true);
          await refreshPricesAction(variantIds, game);
        }}
      >
        <RefreshCw className="h-3.5 w-3.5" /> Refresh prices
      </Button>
    </div>
  );
}
