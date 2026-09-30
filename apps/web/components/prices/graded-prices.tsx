import { convertMinor, formatMoney, type FxRates } from "@tcg-vault/shared";
import {
  GRADING_COMPANY_IDS,
  compareGradeKeys,
  gradeLabel,
  type GradingCompanyId,
} from "@tcg-vault/sources/src/pricing/grading";
import type { GradedPriceRow } from "@tcg-vault/db";
import { GradedRefreshButton } from "./graded-refresh-button";

const COMPANY_NAMES: Record<GradingCompanyId, string> = {
  PSA: "PSA",
  BGS: "Beckett (BGS)",
  CGC: "CGC",
  SGC: "SGC",
  TAG: "TAG",
  ACE: "ACE",
};

function money(amount: number, currency: string, displayCurrency: string, rates: FxRates): string {
  const converted =
    currency !== displayCurrency ? convertMinor(amount, currency, displayCurrency, rates) : null;
  return converted !== null
    ? `≈${formatMoney({ amount: converted, currency: displayCurrency })}`
    : formatMoney({ amount, currency });
}

/**
 * Graded-slab prices: one row per grading company, one column per grade that
 * has listings (premium tiers like BGS 10 Black Label get their own column).
 * Asking prices from eBay — never sold prices — with the listing count in
 * every cell, so a number backed by one listing looks like what it is.
 */
export function GradedPrices({
  variantId,
  language,
  rows,
  displayCurrency,
  rates,
  canFetch,
  blockedReason,
}: {
  variantId: string;
  language: string;
  rows: GradedPriceRow[];
  displayCurrency: string;
  rates: FxRates;
  canFetch: boolean;
  /** Why the button can't work (eBay off / no keys), shown instead of it. */
  blockedReason: string | null;
}) {
  const columns = [...new Set(rows.map((r) => r.gradeKey))].sort(compareGradeKeys);
  const companies = GRADING_COMPANY_IDS.filter((c) => rows.some((r) => r.company === c));
  const cell = (company: string, key: string) =>
    rows.find((r) => r.company === company && r.gradeKey === key);
  const fetchedAt = rows.reduce((t, r) => Math.max(t, r.observedAt.getTime()), 0);

  return (
    <section className="panel p-5" aria-label="Graded prices">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Graded prices</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            eBay asking prices by grading company and grade, not sold prices.
            {fetchedAt > 0 ? ` Updated ${new Date(fetchedAt).toLocaleString()}.` : ""}
          </p>
        </div>
        {canFetch ? (
          <GradedRefreshButton
            variantId={variantId}
            language={language}
            hasData={rows.length > 0}
          />
        ) : null}
      </div>

      {!canFetch && blockedReason ? (
        <p className="mt-3 text-sm text-neutral-500">{blockedReason}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          No graded prices loaded yet. Press the button to look for PSA, BGS, CGC and SGC listings
          of this card.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="py-1.5 pr-4 font-medium">Company</th>
                {columns.map((key) => (
                  <th key={key} className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                    {gradeLabel(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company} className="border-t">
                  <th scope="row" className="whitespace-nowrap py-2 pr-4 text-left font-medium">
                    {COMPANY_NAMES[company]}
                  </th>
                  {columns.map((key) => {
                    const c = cell(company, key);
                    return (
                      <td key={key} className="whitespace-nowrap px-2 py-2 text-right">
                        {c ? (
                          <span
                            title={`Lowest ${money(c.low, c.currency, displayCurrency, rates)}, median of ${c.listingCount} listing${c.listingCount === 1 ? "" : "s"}`}
                          >
                            {money(c.median, c.currency, displayCurrency, rates)}
                            <span className="ml-1 text-[10px] text-neutral-400">
                              ×{c.listingCount}
                            </span>
                          </span>
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-neutral-400">
            Median asking price; ×N is how many listings it comes from. Hover a price for the lowest
            listing. Few listings means a rough number.
          </p>
        </div>
      )}
    </section>
  );
}
