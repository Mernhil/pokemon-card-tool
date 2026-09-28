import { BUILTIN_FX_RATES, type FxRates } from "@tcg-vault/shared";
import { prisma } from "./client";
import { runJob, type JobRunOptions } from "./jobs/runner";

/**
 * Exchange rates from the European Central Bank's daily reference rates
 * (free, no key, ~30 currencies, published around 16:00 CET on working
 * days). Fetched in the background through the shared job runner; until the
 * first success, the built-in approximate rates apply. Converted prices are
 * always labelled as approximate in the UI either way.
 */

export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const FX_JOB = "fx";

/** Pure: the ECB daily XML -> { asOf, perEur }. */
export function parseEcbXml(xml: string): { asOf: string | null; perEur: Record<string, number> } {
  const perEur: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
    const rate = Number(m[2]);
    if (Number.isFinite(rate) && rate > 0) perEur[m[1]!] = rate;
  }
  const asOf = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1] ?? null;
  return { asOf, perEur };
}

export async function refreshFxRates(
  options: JobRunOptions & { fetch?: typeof fetch } = {},
): ReturnType<typeof runJob> {
  const fetchImpl = options.fetch ?? fetch;
  return runJob(
    {
      job: FX_JOB,
      game: "*",
      discover: async () => [{ key: "ecb", label: "ECB reference rates" }],
      process: async () => {
        const res = await fetchImpl(ECB_DAILY_URL, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`ECB rates: HTTP ${res.status}`);
        const { asOf, perEur } = parseEcbXml(await res.text());
        if (Object.keys(perEur).length < 5) throw new Error("ECB rates: unexpected response");
        const date = asOf ? new Date(`${asOf}T00:00:00Z`) : new Date();
        await prisma.$transaction(
          Object.entries(perEur).map(([currency, rate]) =>
            prisma.exchangeRate.upsert({
              where: { currency },
              update: { perEur: rate, asOf: date, source: "ecb" },
              create: { currency, perEur: rate, asOf: date, source: "ecb" },
            }),
          ),
        );
      },
    },
    { refreshAfterMs: 20 * 3_600_000, delayMs: 0, maxConsecutiveFailures: 1, ...options },
  );
}

/** Current rates: ECB rates where we have them, built-in approximations for the rest. */
export async function loadFxRates(): Promise<FxRates> {
  const rows = await prisma.exchangeRate.findMany();
  if (rows.length === 0) return BUILTIN_FX_RATES;
  const perEur = { ...BUILTIN_FX_RATES.perEur };
  let asOf = 0;
  for (const row of rows) {
    perEur[row.currency] = row.perEur;
    asOf = Math.max(asOf, row.asOf.getTime());
  }
  return { source: "ecb", asOf: new Date(asOf).toISOString().slice(0, 10), perEur };
}
