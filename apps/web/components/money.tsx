import { formatMoney } from "@tcg-vault/shared";

/** All values in the UI are shown in EUR (Cardmarket's currency). */
export function formatEur(amount: number): string {
  return formatMoney({ amount, currency: "EUR" });
}

/** Small price pill; renders a dash when there's no valuation yet. */
export function PriceChip({
  value,
  prefix,
}: {
  value: number | null | undefined;
  prefix?: string;
}) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-neutral-400">—</span>;
  }
  return (
    <span className="rounded bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
      {prefix}
      {formatEur(value)}
    </span>
  );
}

const FINISH_STYLES: Record<string, { label: string; className: string }> = {
  HOLO: {
    label: "Holo",
    className: "bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200",
  },
  REVERSE_HOLO: {
    label: "Reverse",
    className: "bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200",
  },
  NON_FOIL: { label: "Normal", className: "bg-neutral-100 text-neutral-600" },
};

export function finishLabel(finish: string): string {
  return FINISH_STYLES[finish]?.label ?? finish.replaceAll("_", " ").toLowerCase();
}

export function FinishBadge({ finish }: { finish: string }) {
  const style = FINISH_STYLES[finish] ?? {
    label: finishLabel(finish),
    className: "bg-violet-100 dark:bg-violet-900/50 text-violet-800 dark:text-violet-200",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${style.className}`}
    >
      {style.label}
    </span>
  );
}
