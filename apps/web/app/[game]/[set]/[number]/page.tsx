import Link from "next/link";
import { notFound } from "next/navigation";
import { latestValuations, prisma } from "@tcg-vault/db";
import { formatMoney, mediaUrl } from "@tcg-vault/shared";
import { AddToCollection } from "../../../../components/add-to-collection";
import { CardViewer } from "../../../../components/card-viewer";
import { FinishBadge, PriceChip, finishLabel } from "../../../../components/money";
import { LineChart, type ChartSeries } from "../../../../components/ui/line-chart";
import { cardHref, sortByFinish } from "../../../../lib/cards";

/** "001" / "TG01" from the URL -> the printing whose collector number starts with it. */
async function findPrinting(setId: number, slug: string) {
  const include = {
    card: true,
    rarity: true,
    artist: true,
    variants: {
      include: {
        language: true,
        priceObs: { orderBy: { observedAt: "desc" as const }, take: 10 },
        collection: { select: { quantity: true } },
      },
    },
  };
  const bySlug = await prisma.printing.findFirst({
    where: {
      setId,
      OR: [{ collectorNumber: slug }, { collectorNumber: { startsWith: `${slug}/` } }],
    },
    include,
  });
  if (bySlug || !/^\d+$/.test(slug)) return bySlug;
  // Older links used the bare numeric part ("1" for "001/064").
  return prisma.printing.findFirst({
    where: { setId, sortNumber: parseInt(slug, 10) },
    include,
  });
}

function fmt(amount: number | null, currency: string): string {
  return amount === null ? "—" : formatMoney({ amount, currency });
}

const SERIES_COLOR: Record<string, string> = {
  NON_FOIL: "var(--series-1)",
  HOLO: "var(--series-2)",
  REVERSE_HOLO: "var(--series-3)",
};

/** One card: 3D viewer, prices per finish, price history, add to collection. */
export default async function CardPage({
  params,
}: {
  params: { game: string; set: string; number: string };
}) {
  const game = await prisma.game.findUnique({ where: { slug: params.game } });
  if (!game) notFound();

  const set = await prisma.set.findUnique({
    where: { gameId_code: { gameId: game.id, code: decodeURIComponent(params.set) } },
  });
  if (!set) notFound();

  const printing = await findPrinting(set.id, decodeURIComponent(params.number));
  if (!printing) notFound();

  const variants = sortByFinish(printing.variants);
  const [values, history, neighbours] = await Promise.all([
    latestValuations(variants.map((v) => v.id)),
    prisma.variantValuation.findMany({
      where: { variantId: { in: variants.map((v) => v.id) }, bucket: "NM" },
      orderBy: { day: "asc" },
    }),
    prisma.printing.findMany({
      where: { setId: set.id },
      orderBy: [{ sortNumber: "asc" }, { collectorNumber: "asc" }],
      select: { id: true, collectorNumber: true },
    }),
  ]);
  const latestBySource = (v: (typeof variants)[number], source: string) =>
    v.priceObs.find((o) => o.source === source);
  const owned = variants.map((v) => ({
    finish: v.finish,
    qty: v.collection.reduce((s, c) => s + c.quantity, 0),
  }));
  const ownedTotal = owned.reduce((s, o) => s + o.qty, 0);
  const series: ChartSeries[] = variants
    .map((v) => ({
      id: v.id,
      label: finishLabel(v.finish),
      color: SERIES_COLOR[v.finish] ?? "var(--series-1)",
      points: history
        .filter((h) => h.variantId === v.id)
        .map((h) => ({ t: h.day.getTime(), v: h.valueEur })),
    }))
    .filter((s) => s.points.length > 0);
  const days = new Set(history.map((h) => h.day.getTime())).size;
  const idx = neighbours.findIndex((n) => n.id === printing.id);
  const prev = idx > 0 ? neighbours[idx - 1] : undefined;
  const next = idx >= 0 && idx < neighbours.length - 1 ? neighbours[idx + 1] : undefined;
  const lastUpdate = Math.max(
    0,
    ...variants.flatMap((v) => v.priceObs.map((o) => o.observedAt.getTime())),
  );

  return (
    <main className="page">
      <div className="mb-4 flex items-center justify-between text-xs">
        <Link
          href={`/${game.slug}/${encodeURIComponent(set.code)}`}
          className="flex items-center gap-2 font-semibold uppercase tracking-[0.14em] text-accent hover:underline"
        >
          {set.symbolUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={set.symbolUrl} alt="" className="h-4 w-4 object-contain" />
          ) : null}
          {set.name}
        </Link>
        <span className="flex gap-3 text-neutral-500">
          {prev ? (
            <Link
              href={cardHref(game.slug, set.code, prev.collectorNumber)}
              className="hover:text-neutral-900"
            >
              ← {prev.collectorNumber}
            </Link>
          ) : null}
          {next ? (
            <Link
              href={cardHref(game.slug, set.code, next.collectorNumber)}
              className="hover:text-neutral-900"
            >
              {next.collectorNumber} →
            </Link>
          ) : null}
        </span>
      </div>

      <div className="grid gap-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <CardViewer
            imageSrc={printing.imageKey ? mediaUrl(printing.imageKey) : null}
            name={printing.card.name}
            number={printing.collectorNumber}
            rarityName={printing.rarity?.name ?? null}
            variants={variants.map((v) => ({ id: v.id, finish: v.finish }))}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <header>
            <h1 className="font-display text-4xl font-semibold tracking-tight">
              {printing.card.name}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-500">
              <span>{printing.collectorNumber}</span>
              {printing.rarity ? <span>· {printing.rarity.name}</span> : null}
              {printing.artist ? <span>· Illustrated by {printing.artist.name}</span> : null}
            </p>
            {ownedTotal > 0 ? (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-neutral-800">
                You own {ownedTotal}
                {owned.filter((o) => o.qty > 0).length > 1 || variants.length > 1
                  ? ` (${owned
                      .filter((o) => o.qty > 0)
                      .map((o) => `${o.qty} ${finishLabel(o.finish)}`)
                      .join(", ")})`
                  : ""}
                <Link href="/collection" className="text-accent hover:underline">
                  View
                </Link>
              </p>
            ) : null}
          </header>

          <AddToCollection
            cardName={printing.card.name}
            variants={variants.map((v) => ({
              id: v.id,
              finish: v.finish,
              value: values.get(v.id)?.valueEur ?? null,
            }))}
          />

          <section className="panel p-5">
            <h2 className="mb-3 text-sm font-semibold">Prices</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-neutral-500">
                  <th className="pb-2 font-medium">Finish</th>
                  <th className="pb-2 font-medium">Value (NM)</th>
                  <th className="pb-2 font-medium">Cardmarket trend</th>
                  <th className="pb-2 font-medium">TCGplayer market</th>
                  <th className="pb-2 text-right font-medium">Owned</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => {
                  const cm = latestBySource(v, "CARDMARKET");
                  const tp = latestBySource(v, "TCGPLAYER");
                  const qty = owned.find((o) => o.finish === v.finish)?.qty ?? 0;
                  return (
                    <tr key={v.id} className="border-b last:border-b-0">
                      <td className="py-2">
                        <FinishBadge finish={v.finish} />
                      </td>
                      <td className="py-2">
                        <PriceChip value={values.get(v.id)?.valueEur} />
                      </td>
                      <td className="py-2 tabular-nums text-neutral-600">
                        {cm ? fmt(cm.trend ?? cm.mid ?? cm.low, cm.currency) : "—"}
                      </td>
                      <td className="py-2 tabular-nums text-neutral-600">
                        {tp ? fmt(tp.market ?? tp.mid ?? tp.low, tp.currency) : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums text-neutral-600">{qty || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-neutral-400">
              {lastUpdate > 0 ? (
                <>Prices via TCGdex, updated {new Date(lastUpdate).toLocaleDateString()}.</>
              ) : (
                <>
                  No prices yet — run a sync from the{" "}
                  <Link href="/sync" className="underline">
                    Sync
                  </Link>{" "}
                  page.
                </>
              )}
            </p>
          </section>

          <section className="panel p-5">
            <h2 className="mb-3 text-sm font-semibold">Price history</h2>
            {days >= 2 ? (
              <LineChart
                series={series}
                label={`${printing.card.name} near-mint value over time`}
              />
            ) : (
              <p className="text-sm text-neutral-500">
                The chart fills in as prices are refreshed — one point per day the app syncs
                {days === 1 ? " (1 so far)" : ""}.
              </p>
            )}
          </section>

          {printing.card.rulesText ? (
            <section className="panel p-5">
              <h2 className="mb-2 text-sm font-semibold">Card text</h2>
              <p className="whitespace-pre-line text-sm text-neutral-700">
                {printing.card.rulesText}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
