import { writeFileSync } from "node:fs";
import { prisma } from "./client";
import { imageCandidatesFor, parseImageUrls } from "./image-cache";
import { bucketFor, fetchFirstImage, type Bucket } from "./image-fetch";

/**
 * Read-only diagnostic: which printings have no scan, and (with --probe)
 * why the ones that have URLs still don't show one.
 *
 *   pnpm db:image-report                     per set: printings, printings with no image URL at all
 *   pnpm db:image-report -- --probe          also probe each printing's URLs (HEAD, rate-limited)
 *   pnpm db:image-report -- --probe --sample 5      only 5 printings per set (evenly spread)
 *   pnpm db:image-report -- --probe --stored-only   probe only the URLs stored by the sync
 *                                                   (what the app did before it built CDN candidates)
 *   --csv missing.csv   every card still without a loadable image (set, number, name, id, why),
 *                       so they can be looked up by hand; use with --probe and no --sample for the full list
 *   --game <slug>  --sets a,b  --top 25  --concurrency 3  --delay-ms 200  --json out.json
 *
 * Point DATABASE_URL at a COPY of the app database to inspect your real data
 * (the app keeps it in the OS app-data directory, identifier app.tcgvault.desktop).
 * Nothing is written to the database and no image body is downloaded.
 */

const BUCKETS: Bucket[] = ["ok", "404", "429", "5xx", "timeout", "non-image", "network", "other"];

interface Args {
  game: string | null;
  sets: string[] | null;
  probe: boolean;
  sample: number | null;
  storedOnly: boolean;
  top: number;
  concurrency: number;
  delayMs: number;
  json: string | null;
  csv: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    game: null,
    sets: null,
    probe: false,
    sample: null,
    storedOnly: false,
    top: 25,
    concurrency: 3,
    delayMs: 150,
    json: null,
    csv: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--probe") args.probe = true;
    else if (a === "--stored-only") args.storedOnly = true;
    else if (a === "--game") args.game = argv[++i] ?? null;
    else if (a === "--sets") args.sets = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--sample") args.sample = Number(argv[++i]);
    else if (a === "--top") args.top = Number(argv[++i]);
    else if (a === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]));
    else if (a === "--delay-ms") args.delayMs = Math.max(0, Number(argv[++i]));
    else if (a === "--json") args.json = argv[++i] ?? null;
    else if (a === "--csv") args.csv = argv[++i] ?? null;
  }
  return args;
}

interface SetRow {
  code: string;
  name: string;
  total: number;
  noUrls: number;
  probed: number;
  buckets: Record<Bucket, number>;
}

const emptyBuckets = (): Record<Bucket, number> =>
  Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `n` items spread evenly over the list (deterministic). */
function spread<T>(items: T[], n: number): T[] {
  if (n >= items.length) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]!);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sets = await prisma.set.findMany({
    where: {
      ...(args.game ? { game: { slug: args.game } } : {}),
      ...(args.sets ? { code: { in: args.sets } } : {}),
    },
    orderBy: [{ game: { slug: "asc" } }, { releaseDate: "desc" }],
    select: {
      id: true,
      code: true,
      name: true,
      series: true,
      game: { select: { slug: true } },
    },
  });

  const rows: SetRow[] = [];
  const totals = { total: 0, noUrls: 0, probed: 0, buckets: emptyBuckets() };
  const worstExamples: Array<{ set: string; card: string; bucket: Bucket }> = [];
  const missingRows: string[][] = [];
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;

  for (const set of sets) {
    const printings = await prisma.printing.findMany({
      where: { setId: set.id },
      orderBy: { sortNumber: "asc" },
      select: {
        id: true,
        imageUrls: true,
        collectorNumber: true,
        customImageKey: true,
        card: { select: { name: true } },
      },
    });
    const row: SetRow = {
      code: set.code,
      name: set.name,
      total: printings.length,
      noUrls: printings.filter((p) => parseImageUrls(p.imageUrls).length === 0).length,
      probed: 0,
      buckets: emptyBuckets(),
    };

    if (args.probe) {
      const targets = spread(
        printings.filter((p) => !p.customImageKey),
        args.sample ?? printings.length,
      );
      let next = 0;
      const worker = async () => {
        for (;;) {
          const p = targets[next++];
          if (!p) return;
          const urls = args.storedOnly
            ? parseImageUrls(p.imageUrls)
            : imageCandidatesFor({
                imageUrls: p.imageUrls,
                collectorNumber: p.collectorNumber,
                set: { code: set.code, series: set.series, game: set.game },
              });
          const { image, attempts } = await fetchFirstImage(urls, {
            method: "HEAD",
            retries: 0,
            limiter: null,
            timeoutMs: 15_000,
          });
          const bucket = urls.length === 0 ? "404" : bucketFor(attempts, image !== null);
          row.probed++;
          row.buckets[bucket]++;
          if (bucket !== "ok") {
            missingRows.push([set.game.slug, set.code, set.name, p.collectorNumber, p.card.name, p.id, bucket]);
          }
          if (bucket !== "ok" && worstExamples.length < 200) {
            worstExamples.push({
              set: set.code,
              card: `${p.card.name} ${p.collectorNumber}`,
              bucket,
            });
          }
          if (args.delayMs) await sleep(args.delayMs);
        }
      };
      await Promise.all(Array.from({ length: args.concurrency }, worker));
      console.error(
        `probed ${set.code} (${row.probed}): ${BUCKETS.filter((b) => row.buckets[b]).map((b) => `${b}=${row.buckets[b]}`).join(" ")}`,
      );
    }

    if (!args.probe) {
      for (const p of printings) {
        if (parseImageUrls(p.imageUrls).length === 0 && !p.customImageKey) {
          missingRows.push([set.game.slug, set.code, set.name, p.collectorNumber, p.card.name, p.id, "no-url"]);
        }
      }
    }
    rows.push(row);
    totals.total += row.total;
    totals.noUrls += row.noUrls;
    totals.probed += row.probed;
    for (const b of BUCKETS) totals.buckets[b] += row.buckets[b];
  }

  const missing = (r: SetRow) => (args.probe ? r.probed - r.buckets.ok : r.noUrls);
  const worst = [...rows]
    .filter((r) => missing(r) > 0)
    .sort((a, b) => missing(b) - missing(a) || b.total - a.total)
    .slice(0, args.top);

  console.log(`\n=== image report (${sets.length} sets, ${totals.total} printings) ===`);
  console.log(
    `no image URL at all: ${totals.noUrls} (${((100 * totals.noUrls) / Math.max(1, totals.total)).toFixed(1)}%)`,
  );
  if (args.probe) {
    console.log(
      `probed ${totals.probed} printings${args.storedOnly ? " (stored URLs only)" : " (stored + constructed CDN candidates)"}:`,
    );
    for (const b of BUCKETS) if (totals.buckets[b]) console.log(`  ${b.padEnd(10)} ${totals.buckets[b]}`);
  }
  console.log(`\nworst ${worst.length} sets by ${args.probe ? "printings without a loadable image" : "printings with no image URL"}:`);
  console.log(
    `${"set".padEnd(12)} ${"name".padEnd(34)} ${"total".padStart(6)} ${"no-url".padStart(7)}${args.probe ? ` ${"probed".padStart(7)} ${BUCKETS.slice(1).map((b) => b.padStart(9)).join("")}` : ""}`,
  );
  for (const r of worst) {
    console.log(
      `${r.code.padEnd(12)} ${r.name.slice(0, 34).padEnd(34)} ${String(r.total).padStart(6)} ${String(r.noUrls).padStart(7)}${
        args.probe
          ? ` ${String(r.probed).padStart(7)} ${BUCKETS.slice(1).map((b) => String(r.buckets[b]).padStart(9)).join("")}`
          : ""
      }`,
    );
  }

  if (args.csv) {
    const header = ["game", "set_code", "set_name", "collector_number", "card_name", "printing_id", "problem"];
    writeFileSync(
      args.csv,
      [header, ...missingRows].map((r) => r.map(cell).join(",")).join(String.fromCharCode(10)) + String.fromCharCode(10),
    );
    console.log(`${missingRows.length} cards without a loadable image listed in ${args.csv}`);
  }

  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ totals, rows, examples: worstExamples }, null, 2));
    console.log(`\nfull report written to ${args.json}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
