"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Button } from "../../components/ui/button";
import {
  cardTraderPassStatusAction,
  startCardTraderPassAction,
  type CardTraderPassStatus,
} from "./actions";

/** Prices every Pokémon card from CardTrader (not only the collection) and shows progress. */
export function CardTraderPass() {
  const [status, setStatus] = useState<CardTraderPassStatus | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    const load = () =>
      cardTraderPassStatusAction()
        .then((s) => live && setStatus(s))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 5_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const total = status ? status.pending + status.done + status.failed + status.unavailable : 0;
  const finished = status ? total - status.pending : 0;
  const running = (status?.pending ?? 0) > 0;

  return (
    <section className="panel mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">CardTrader prices for every Pokémon card</h2>
          <p className="text-xs text-neutral-500">
            Normally only your collection and cards you open are priced. This checks the whole
            catalog against CardTrader (about 4 cards a second, so a full pass takes a while) and
            keeps going in the background while the app is open.
          </p>
        </div>
        <Button
          disabled={busy || !status?.available}
          onClick={() =>
            startTransition(async () => {
              await startCardTraderPassAction();
              setStatus(await cardTraderPassStatusAction());
            })
          }
        >
          <RefreshCw className={`h-4 w-4 ${busy || running ? "animate-spin" : ""}`} />
          {running ? "Restart full check" : "Check all cards"}
        </Button>
      </div>
      {status && !status.available ? (
        <p className="mt-3 text-xs text-neutral-500">
          Add your CardTrader token in Settings (and turn CardTrader on) first.
        </p>
      ) : null}
      {status && total > 0 ? (
        <div className="mt-4">
          <div className="flex justify-between text-xs tabular-nums text-neutral-500">
            <span>
              {finished} / {total} checked
              {status.failed ? ` · ${status.failed} failed (retried next run)` : ""}
              {status.unavailable ? ` · ${status.unavailable} not on CardTrader` : ""}
            </span>
            <span>{running ? "Running…" : "Idle"}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${total ? (finished / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
