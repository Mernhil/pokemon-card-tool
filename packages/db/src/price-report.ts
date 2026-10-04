import { writeFileSync } from "node:fs";
import { prisma } from "./client";

/**
 * Which ordinary-print variants no provider has ever priced, per set — the
 * price twin of image-report.ts. Read-only, database only.
 *
 *   pnpm db:price-report                      per set: variants, variants with no price at all
 *   pnpm db:price-report -- --csv out.csv     every unpriced variant, to look up by hand
 *   --game <slug>   --top 25
 *
 * Variants of other editions (1st Edition) are left out: only TCGdex prices
 * those. Digital (Pocket) sets have no market and are left out too.
 */

export interface UnpricedVariant {
  variantId: string;
  gameSlug: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  cardName: string;
  finish: string;
  languageCode: string;
}

export interface SetPriceCoverage {
  setCode: string;
  setName: string;
  total: number;
  unpriced: number;
}

export interface PriceCoverage {
  total: number;
  unpriced: number;
  sets: SetPriceCoverage[];
  variants: UnpricedVariant[];
}

export async function priceCoverage(game = "pokemon"): Promise<PriceCoverage> {
  const where = {
    edition: "UNLIMITED",
    printing: { set: { game: { slug: game }, category: { not: "pocket" } } },
  };
  const [totals, missing] = await Promise.all([
    prisma.$queryRaw<Array<{ code: string; total: bigint }>>`
      SELECT s."code" AS code, COUNT(*) AS total
      FROM "PrintVariant" v
      JOIN "Printing" p ON p."id" = v."printingId"
      JOIN "Set" s ON s."id" = p."setId"
      JOIN "Game" g ON g."id" = s."gameId"
      WHERE v."edition" = 'UNLIMITED' AND g."slug" = ${game}
        AND (s."category" IS NULL OR s."category" <> 'pocket')
      GROUP BY s."code"`,
    prisma.printVariant.findMany({
      where: { ...where, priceObs: { none: {} } },
      select: {
        id: true,
        finish: true,
        languageCode: true,
        printing: {
          select: {
            collectorNumber: true,
            sortNumber: true,
            card: { select: { name: true } },
            set: { select: { code: true, name: true, game: { select: { slug: true } } } },
          },
        },
      },
    }),
  ]);
  const totalBySet = new Map(totals.map((t) => [t.code, Number(t.total)]));
  const variants: UnpricedVariant[] = missing
    .map((v) => ({
      variantId: v.id,
      gameSlug: v.printing.set.game.slug,
      setCode: v.printing.set.code,
      setName: v.printing.set.name,
      collectorNumber: v.printing.collectorNumber,
      cardName: v.printing.card.name,
      finish: v.finish,
      languageCode: v.languageCode,
      sort: v.printing.sortNumber,
    }))
    .sort((a, b) => a.setCode.localeCompare(b.setCode) || a.sort - b.sort)
    .map(({ sort: _sort, ...rest }) => rest);

  const bySet = new Map<string, SetPriceCoverage>();
  for (const [code, total] of totalBySet) bySet.set(code, { setCode: code, setName: code, total, unpriced: 0 });
  for (const v of variants) {
    const row = bySet.get(v.setCode) ?? { setCode: v.setCode, setName: v.setName, total: 0, unpriced: 0 };
    row.setName = v.setName;
    row.unpriced++;
    bySet.set(v.setCode, row);
  }
  const sets = [...bySet.values()].filter((s) => s.unpriced > 0).sort((a, b) => b.unpriced - a.unpriced);
  const total = [...totalBySet.values()].reduce((a, b) => a + b, 0);
  return { total, unpriced: variants.length, sets, variants };
}

export function coverageCsv(variants: UnpricedVariant[]): string {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ["game", "set_code", "set_name", "collector_number", "card_name", "finish", "language", "variant_id"];
  const rows = variants.map((v) => [
    v.gameSlug,
    v.setCode,
    v.setName,
    v.collectorNumber,
    v.cardName,
    v.finish,
    v.languageCode,
    v.variantId,
  ]);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const game = arg("--game") ?? "pokemon";
  const top = Number(arg("--top") ?? 25);
  const report = await priceCoverage(game);
  console.log(
    `\n=== price coverage (${game}): ${report.unpriced} of ${report.total} variants have no price (${((100 * report.unpriced) / Math.max(1, report.total)).toFixed(1)}%) ===`,
  );
  console.log(`${"set".padEnd(12)} ${"name".padEnd(34)} ${"total".padStart(6)} ${"unpriced".padStart(9)}`);
  for (const s of report.sets.slice(0, top))
    console.log(
      `${s.setCode.padEnd(12)} ${s.setName.slice(0, 34).padEnd(34)} ${String(s.total).padStart(6)} ${String(s.unpriced).padStart(9)}`,
    );
  const csv = arg("--csv");
  if (csv) {
    writeFileSync(csv, coverageCsv(report.variants));
    console.log(`${report.variants.length} unpriced variants listed in ${csv}`);
  }
}

// Only when run as the CLI (tsx src/price-report.ts), not when imported by the app.
if (process.argv[1]?.endsWith("price-report.ts")) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
