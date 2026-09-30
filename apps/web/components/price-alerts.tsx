"use client";

import { BellRing, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPriceAlertAction, deletePriceAlertAction } from "../app/actions";
import { formatEur } from "./money";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";

export interface AlertItem {
  id: string;
  direction: "ABOVE" | "BELOW";
  thresholdEur: number;
  triggered: boolean;
  triggeredValueEur: number | null;
  /** Shown on the dashboard, where alerts are listed across cards. */
  label?: string;
  href?: string;
}

/** Card page: set a new alert for the finish being viewed, and see/remove its existing ones. */
export function PriceAlerts({
  variantId,
  currentValueEur,
  alerts,
}: {
  variantId: string;
  currentValueEur: number | null;
  alerts: AlertItem[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [direction, setDirection] = useState<"ABOVE" | "BELOW">("ABOVE");
  const [euros, setEuros] = useState("");

  const add = () => {
    const value = Number(euros.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      toast("error", "Enter a price above zero.");
      return;
    }
    start(async () => {
      const res = await createPriceAlertAction({
        variantId,
        direction,
        thresholdEur: Math.round(value * 100),
      });
      if (!res.ok) toast("error", res.error);
      else {
        toast("success", "Alert set");
        setEuros("");
      }
      router.refresh();
    });
  };

  return (
    <section className="panel p-4" aria-label="Price alerts">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <BellRing className="h-4 w-4 text-accent" /> Price alert
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        Tell me when it goes
        <select
          className="field py-1"
          value={direction}
          onChange={(e) => setDirection(e.target.value as "ABOVE" | "BELOW")}
          aria-label="Direction"
        >
          <option value="ABOVE">above</option>
          <option value="BELOW">below</option>
        </select>
        <span>€</span>
        <input
          className="field w-24 py-1"
          inputMode="decimal"
          placeholder={currentValueEur !== null ? (currentValueEur / 100).toFixed(2) : "0.00"}
          value={euros}
          onChange={(e) => setEuros(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label="Price in euros"
        />
        <Button size="sm" variant="secondary" onClick={add} disabled={pending}>
          Set alert
        </Button>
      </div>
      <AlertList alerts={alerts} />
    </section>
  );
}

/** The alerts themselves; triggered ones are highlighted and stay until dismissed. */
export function AlertList({ alerts }: { alerts: AlertItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [, start] = useTransition();
  if (alerts.length === 0) return null;

  const remove = (id: string) =>
    start(async () => {
      const res = await deletePriceAlertAction(id);
      if (!res.ok) toast("error", res.error);
      router.refresh();
    });

  return (
    <ul className="mt-3 space-y-1.5 text-sm">
      {alerts.map((a) => (
        <li
          key={a.id}
          className={`flex items-center gap-2 rounded-md px-2 py-1 ${a.triggered ? "bg-accent-soft font-medium" : ""}`}
        >
          <span className="min-w-0 flex-1 truncate">
            {a.label && a.href ? (
              <a href={a.href} className="hover:text-accent">
                {a.label}
              </a>
            ) : null}{" "}
            {a.direction === "ABOVE" ? "above" : "below"} {formatEur(a.thresholdEur)}
            {a.triggered
              ? a.triggeredValueEur !== null
                ? ` · reached (${formatEur(a.triggeredValueEur)})`
                : " · reached"
              : ""}
          </span>
          <button
            type="button"
            onClick={() => remove(a.id)}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
            aria-label={a.triggered ? "Dismiss alert" : "Delete alert"}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
