"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { pricesUpdatingAction, refreshPricesAction } from "../../app/[game]/[set]/[number]/actions";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";

/** The longest the button waits for a background refresh before giving up on "Updating…". */
const MAX_WAIT_MS = 90_000;

export interface RefreshProviderStatus {
  id: string;
  label: string;
  state: string;
  message: string | null;
  updatedAt: number | null;
}

export function timeAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** One line per provider: what happened to it on the last refresh. */
export function providerOutcome(p: RefreshProviderStatus, now = Date.now()): string {
  if (p.state === "ok" || p.state === "no_data") {
    if (p.updatedAt) return `${p.label} updated ${timeAgo(p.updatedAt, now)}`;
    return `${p.label}: no prices yet`;
  }
  return `${p.label}: ${p.message ?? p.state.replace("_", " ")}`;
}

/**
 * "Refresh prices" + a subtle "Updating…" while a background refresh for
 * this card is queued/running. Polls the DB (never a provider) and refreshes
 * the page's server data once the update lands. It can never stay stuck: the
 * wait is capped, errors are toasted, and the button is re-enabled afterwards.
 */
export function PriceRefresh({
  variantIds,
  game,
  initiallyUpdating,
  providers,
}: {
  variantIds: string[];
  game: string;
  initiallyUpdating: boolean;
  providers: RefreshProviderStatus[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [updating, setUpdating] = useState(initiallyUpdating);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!updating) return;
    let stopped = false;
    const started = Date.now();
    const finish = () => {
      setUpdating(false);
      startTransition(() => router.refresh());
    };
    const tick = async () => {
      if (stopped) return;
      const still = await pricesUpdatingAction(variantIds, game).catch(() => false);
      if (stopped) return;
      if (!still || Date.now() - started > MAX_WAIT_MS) finish();
      else timer = setTimeout(tick, 2_000);
    };
    let timer = setTimeout(tick, 2_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [updating, variantIds, game, router]);

  const lastUpdated = providers.reduce<number | null>(
    (max, p) => (p.updatedAt !== null && (max === null || p.updatedAt > max) ? p.updatedAt : max),
    null,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        {updating ? (
          <span className="flex items-center gap-1.5 text-xs text-neutral-500" aria-live="polite">
            <RefreshCw className="h-3 w-3 animate-spin" /> Updating…
          </span>
        ) : lastUpdated !== null ? (
          <span suppressHydrationWarning className="text-xs text-neutral-500">Last updated {timeAgo(lastUpdated)}</span>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          disabled={updating}
          onClick={async () => {
            setUpdating(true);
            try {
              const { started } = await refreshPricesAction(variantIds, game);
              if (!started) {
                toast("error", "No price provider is available for this game right now.");
                setUpdating(false);
                startTransition(() => router.refresh());
              }
            } catch (err) {
              toast("error", err instanceof Error ? err.message : "Couldn't refresh prices.");
              setUpdating(false);
            }
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh prices
        </Button>
      </div>
      {!updating && providers.length > 0 ? (
        <ul className="text-right text-[11px] leading-snug text-neutral-500">
          {providers.map((p) => (
            <li key={p.id} suppressHydrationWarning>{providerOutcome(p)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
