import {
  PRICE_KIND_LABELS,
  convertMinor,
  formatMoney,
  priceLanguageLabel,
  type FxRates,
} from "@tcg-vault/shared";
import { ChevronDown, CircleAlert, ExternalLink, KeyRound, PauseCircle, SearchX, Timer } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  PROVIDER_COLORS,
  bestValue,
  type CardPrices,
  type ProviderPanelData,
  type SerializedPoint,
} from "../../lib/card-prices";
import { ConditionEstimate } from "./condition-estimate";
import { MappingForm } from "./mapping-form";

const CONDITION_SHORT: Record<string, string> = {
  MINT: "Mint",
  NEAR_MINT: "NM",
  LIGHTLY_PLAYED: "LP",
  MODERATELY_PLAYED: "MP",
  HEAVILY_PLAYED: "HP",
  DAMAGED: "DMG",
};

function timeAgo(t: number, now = Date.now()): string {
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(t).toLocaleDateString();
}

/** Native amount, plus "≈ converted" when the display currency differs. */
function Amount({
  p,
  displayCurrency,
  rates,
  big = false,
}: {
  p: SerializedPoint;
  displayCurrency: string;
  rates: FxRates;
  big?: boolean;
}) {
  const native = formatMoney({ amount: p.amount, currency: p.currency });
  const converted =
    p.currency !== displayCurrency
      ? convertMinor(p.amount, p.currency, displayCurrency, rates)
      : null;
  return (
    <span className="tabular-nums">
      <span className={big ? "text-2xl font-semibold tracking-tight text-neutral-950" : ""}>
        {native}
      </span>
      {converted !== null ? (
        <span className={`ml-1.5 text-neutral-500 ${big ? "text-sm" : "text-xs"}`}>
          ≈{formatMoney({ amount: converted, currency: displayCurrency })}
        </span>
      ) : null}
    </span>
  );
}

/** "Lowest listing · NM · 12 listings" — what the number is, always spelled out. */
function KindLine({ p }: { p: SerializedPoint }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
          p.kind === "sold"
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
            : p.kind === "asking" || p.kind === "lowest_listing"
              ? "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200"
              : "bg-neutral-100 text-neutral-700"
        }`}
      >
        {PRICE_KIND_LABELS[p.kind]}
      </span>
      {p.condition ? <span>{CONDITION_SHORT[p.condition] ?? p.condition}</span> : null}
      {p.listingCount !== null ? (
        <span>
          · {p.listingCount} {p.kind === "sold" ? "sale" : "listing"}
          {p.listingCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </span>
  );
}

const STATE_ICON: Record<string, ReactNode> = {
  not_configured: <KeyRound className="h-4 w-4" />,
  disabled: <PauseCircle className="h-4 w-4" />,
  rate_limited: <Timer className="h-4 w-4" />,
  not_found: <SearchX className="h-4 w-4" />,
  error: <CircleAlert className="h-4 w-4" />,
};

const STATE_TITLE: Record<string, string> = {
  no_data: "No data yet",
  no_language: "No listings in this language",
  not_configured: "API key not set",
  disabled: "Disabled",
  rate_limited: "Rate limited",
  not_found: "No match found",
  error: "Couldn't fetch prices",
};

/**
 * The numbers worth seeing without opening the panel: near mint (for providers that split by
 * condition), lowest and highest price (compared in the display currency, across
 * conditions/kinds). Graded slabs have their own table.
 */
function KeyNumbers({ panel, prices }: { panel: ProviderPanelData; prices: CardPrices }) {
  const { displayCurrency } = prices.settings;
  const all = [panel.headline!, ...panel.others];
  const inDisplay = (p: SerializedPoint) =>
    convertMinor(p.amount, p.currency, displayCurrency, prices.rates);
  const ungraded = all
    .map((p) => ({ p, v: inDisplay(p) }))
    .filter((x): x is { p: SerializedPoint; v: number } => x.v !== null);
  const lowest = ungraded.length ? ungraded.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  const highest = ungraded.length > 1 ? ungraded.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  // Only a provider that splits by condition can say "no near mint": an unsplit number is
  // already the near-mint-ish headline, so a missing row there would be misleading.
  const splitsByCondition = ungraded.some((x) => x.p.condition !== null);
  const nearMint = ungraded.find((x) => x.p.condition === "NEAR_MINT")?.p ?? null;
  const rows: Array<{ label: string; p: SerializedPoint | null; empty: string }> = [
    ...(splitsByCondition
      ? [{ label: "Near mint", p: nearMint, empty: "none listed" }]
      : []),
    { label: "Lowest", p: lowest?.p ?? null, empty: "—" },
    { label: "Highest", p: highest?.p ?? null, empty: "—" },
  ];
  return (
    <dl className="mt-3 flex flex-col gap-1 border-t pt-2 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-2">
          <dt className="text-neutral-500">
            {r.label}
            {r.p ? (
              <span className="text-neutral-400">
                {" · "}
                {[
                  PRICE_KIND_LABELS[r.p.kind].toLowerCase().includes(r.label.toLowerCase())
                    ? null
                    : PRICE_KIND_LABELS[r.p.kind],
                  r.p.condition && r.label !== "Near mint"
                    ? (CONDITION_SHORT[r.p.condition] ?? r.p.condition)
                    : null,
                  r.p.listingCount !== null
                    ? `${r.p.listingCount} ${r.p.kind === "sold" ? "sale" : "listing"}${r.p.listingCount === 1 ? "" : "s"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ) : null}
          </dt>
          <dd className="font-medium">
            {r.p ? (
              <Amount p={r.p} displayCurrency={displayCurrency} rates={prices.rates} />
            ) : (
              <span className="font-normal text-neutral-400">{r.empty}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ProviderPanel({
  panel,
  prices,
  variantId,
  game,
}: {
  panel: ProviderPanelData;
  prices: CardPrices;
  variantId: string;
  game: string;
}) {
  const { displayCurrency } = prices.settings;
  const h = panel.headline;
  return (
    <article
      className={`rounded-xl border p-4 ${panel.untrusted ? "border-amber-300 dark:border-amber-800" : ""}`}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: PROVIDER_COLORS[panel.id] }}
            aria-hidden
          />
          {panel.label}
        </h3>
        {panel.mapping?.url ? (
          <a
            href={panel.mapping.url}
            target="_blank"
            rel="noreferrer"
            className="text-neutral-400 hover:text-accent"
            title={`Open on ${panel.label}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </header>

      {h ? (
        <div className="mt-3">
          <Amount p={h} displayCurrency={displayCurrency} rates={prices.rates} big />
          <div className="mt-1.5">
            <KindLine p={h} />
          </div>
          <KeyNumbers panel={panel} prices={prices} />
          <details className="group mt-3 border-t pt-2 text-xs">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-neutral-500 hover:text-neutral-900 [&::-webkit-details-marker]:hidden">
              <span>All prices &amp; details</span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {panel.others.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {[h, ...panel.others].map((o) => (
                    <li
                      key={`${o.kind}-${o.condition}-${o.currency}`}
                      className="flex justify-between gap-2"
                    >
                      <span className="text-neutral-500">
                        {PRICE_KIND_LABELS[o.kind]}
                        {o.condition ? ` · ${CONDITION_SHORT[o.condition] ?? o.condition}` : ""}
                        {o.listingCount !== null
                          ? ` · ${o.listingCount} ${o.kind === "sold" ? "sale" : "listing"}${o.listingCount === 1 ? "" : "s"}`
                          : ""}
                      </span>
                      <Amount p={o} displayCurrency={displayCurrency} rates={prices.rates} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-[11px] text-neutral-500">
                {panel.languageMode === "all-languages"
                  ? "All languages — this source can't split by language, so the number mixes every language."
                  : panel.languageMode === "unsplit"
                    ? "Language not stated by these listings — may mix languages."
                    : `${priceLanguageLabel(prices.language)} listings.`}
              </p>
              <p className="text-[11px] text-neutral-400">
                Updated {panel.updatedAt ? timeAgo(panel.updatedAt) : "—"}
                {!panel.supportsSold ? " · listings/averages, not individual sales" : ""}
              </p>
            </div>
          </details>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-2 text-sm text-neutral-500">
          {STATE_ICON[panel.state] ?? null}
          <div>
            <p className="font-medium text-neutral-700">{STATE_TITLE[panel.state] ?? "No data"}</p>
            {panel.message && panel.message !== STATE_TITLE[panel.state] ? (
              <p className="mt-0.5 text-xs">{panel.message}</p>
            ) : null}
            {panel.state === "not_configured" || panel.state === "disabled" ? (
              <Link
                href="/settings"
                className="mt-1 inline-block text-xs text-accent hover:underline"
              >
                Open Settings
              </Link>
            ) : null}
          </div>
        </div>
      )}

      {panel.untrusted ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          Uncertain match ({Math.round((panel.mapping?.confidence ?? 0) * 100)}%):{" "}
          {panel.mapping?.notes}. Not used for your collection value.
        </p>
      ) : null}
      {(panel.id === "cardtrader" || panel.id === "ebay") && panel.mapping ? (
        <MappingForm
          variantId={variantId}
          provider={panel.id}
          game={game}
          externalId={panel.mapping.externalId}
          query={panel.mapping.query}
          manual={panel.mapping.manualOverride}
        />
      ) : null}
    </article>
  );
}

function BestValueSummary({ prices }: { prices: CardPrices }) {
  const { displayCurrency } = prices.settings;
  const best = bestValue(prices.panels, displayCurrency, prices.rates);
  if (!best.lowest) return null;
  const fmt = (amount: number, approx = false) =>
    `${approx ? "≈" : ""}${formatMoney({ amount, currency: displayCurrency })}`;
  const describe = (p: ProviderPanelData) =>
    `${p.label}, ${PRICE_KIND_LABELS[p.headline!.kind].toLowerCase()}`;
  return (
    <div className="rounded-xl bg-surface-2 p-4 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
        Best value
      </h3>
      <p className="mt-2">
        <span className="text-xl font-semibold tabular-nums">
          {fmt(best.lowest.amount, best.lowest.converted)}
        </span>{" "}
        <span className="text-neutral-500">— {describe(best.lowest.panel)}</span>
      </p>
      {best.highest && best.spread !== null ? (
        <p className="mt-1 text-xs text-neutral-600">
          Highest {fmt(best.highest.amount, best.highest.converted)} ({describe(best.highest.panel)}
          ) · spread{" "}
          <span className="tabular-nums">
            {fmt(best.spread, best.lowest.converted || best.highest.converted)}
          </span>
          {best.lowest.amount > 0
            ? ` (${Math.round((best.spread / best.lowest.amount) * 100)}%)`
            : ""}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-neutral-400">
        {best.mixedKinds
          ? "These are different kinds of price (listings vs averages) — compare with care. "
          : ""}
        {best.converted
          ? `Converted to ${displayCurrency} at ${prices.rates.source === "ecb" ? `ECB rates of ${prices.rates.asOf}` : "built-in approximate rates"}. `
          : ""}
        {best.unconvertible.length
          ? `Not compared (no exchange rate): ${best.unconvertible.join(", ")}. `
          : ""}
        {best.untrusted.length ? `Left out (uncertain match): ${best.untrusted.join(", ")}.` : ""}
      </p>
    </div>
  );
}

/** The card page's Prices section: one panel per provider, best value, condition estimate. */
export function PricesSection({
  prices,
  variantId,
  game,
  header,
}: {
  prices: CardPrices;
  variantId: string;
  game: string;
  /** Finish tabs + refresh control, rendered in the section header. */
  header: ReactNode;
}) {
  const headlines = prices.panels
    .filter((p) => p.headline && !p.untrusted)
    .map((p) => ({
      label: p.label,
      headline: p.headline!,
      actual: [p.headline!, ...p.others],
    }));
  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Prices</h2>
        {header}
      </div>
      {!prices.languageFilterable ? (
        <p className="mb-3 text-xs text-neutral-500">
          Language filtering needs eBay or CardTrader — Cardmarket and TCGplayer (via TCGdex) mix every
          language. Add an API key in Settings to enable it.
        </p>
      ) : null}
      {prices.languageMissing ? (
        <p className="mb-3 text-xs text-neutral-500">
          Looking up {priceLanguageLabel(prices.language)} listings in the background — refresh in a
          moment.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {prices.panels.map((panel) => (
          <ProviderPanel
            key={panel.id}
            panel={panel}
            prices={prices}
            variantId={variantId}
            game={game}
          />
        ))}
      </div>
      <div className="mt-4">
        <BestValueSummary prices={prices} />
      </div>
      <ConditionEstimate
        rows={headlines}
        displayCurrency={prices.settings.displayCurrency}
        rates={prices.rates}
      />
      <p className="mt-4 text-xs text-neutral-400">
        Sold = completed sales · Market avg = a marketplace&apos;s average of recent sales · Trend =
        its smoothed trend · Asking / Lowest listing = what sellers ask now, not what cards sold
        for. Prices are refreshed in the background; this page only shows what&apos;s stored.
      </p>
    </section>
  );
}
