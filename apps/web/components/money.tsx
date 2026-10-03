import { EDITION_LABELS, parseVariantKind } from "@tcg-vault/shared/src/enums";
import { convertMinor, formatMoney } from "@tcg-vault/shared/src/currency";

/**
 * Valuations are computed and stored in EUR; they're shown in the display
 * currency chosen in Settings, converted at the current exchange rate and
 * marked "≈" when converted. Configured once per runtime: on the server by
 * lib/money-config.ts, in the browser by <MoneyConfig> in the root layout.
 */
export interface MoneyDisplay {
  currency: string;
  /** Units of `currency` per 1 EUR. */
  perEur: number;
}

let display: MoneyDisplay = { currency: "EUR", perEur: 1 };

export function configureMoney(next: MoneyDisplay): void {
  display = next;
}

export function moneyDisplay(): MoneyDisplay {
  return display;
}

/** EUR minor units -> converted to the display currency (EUR minor units in, never another currency). */
export function eurToDisplay(amount: number): {
  amount: number;
  currency: string;
  converted: boolean;
} {
  if (display.currency === "EUR") return { amount, currency: "EUR", converted: false };
  const converted = convertMinor(amount, "EUR", display.currency, {
    source: "ecb",
    asOf: null,
    perEur: { EUR: 1, [display.currency]: display.perEur },
  });
  return converted === null
    ? { amount, currency: "EUR", converted: false }
    : { amount: converted, currency: display.currency, converted: true };
}

/** A value stored in EUR minor units, formatted in the display currency. */
export function formatEur(amount: number): string {
  const shown = eurToDisplay(amount);
  const text = formatMoney({ amount: shown.amount, currency: shown.currency });
  return shown.converted ? `≈${text}` : text;
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

/** Label for a finish or a variant kind ("HOLO", "FIRST_EDITION:HOLO"; see variantKind). */
export function finishLabel(kind: string): string {
  const { edition, finish } = parseVariantKind(kind);
  const base = FINISH_STYLES[finish]?.label ?? finish.replaceAll("_", " ").toLowerCase();
  const prefix = EDITION_LABELS[edition];
  return prefix ? `${prefix} ${base}` : base;
}

export function FinishBadge({ finish: kind }: { finish: string }) {
  const finish = parseVariantKind(kind).finish;
  const style = FINISH_STYLES[finish] ?? {
    label: finishLabel(kind),
    className: "bg-violet-100 dark:bg-violet-900/50 text-violet-800 dark:text-violet-200",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${style.className}`}
    >
      {EDITION_LABELS[parseVariantKind(kind).edition] ? finishLabel(kind) : style.label}
    </span>
  );
}
