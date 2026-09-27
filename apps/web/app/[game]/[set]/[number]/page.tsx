import Link from "next/link";
import { notFound } from "next/navigation";
import { latestValuations, prisma } from "@tcg-vault/db";
import { formatMoney, mediaUrl } from "@tcg-vault/shared";
import { CONDITIONS, GRADING_COMPANIES } from "@tcg-vault/shared";
import { addToCollection } from "../../../actions";
import { FinishBadge, PriceChip, finishLabel, formatEur } from "../../../../components/money";
import { sortByFinish } from "../../../../lib/cards";

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
        _count: { select: { collection: true } },
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

/** SEO-indexable card page: one Printing, its variants, prices and marketplace links. */
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
  const values = await latestValuations(variants.map((v) => v.id));
  const latestBySource = (v: (typeof variants)[number], source: string) =>
    v.priceObs.find((o) => o.source === source);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <div className="flex flex-col gap-8 sm:flex-row">
        {printing.imageKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(printing.imageKey)}
            alt={printing.card.name}
            className="h-auto w-56 shrink-0 self-start rounded-lg"
          />
        ) : (
          <div className="aspect-[5/7] w-56 shrink-0 self-start rounded-lg bg-neutral-100" />
        )}

        <div>
          <h1 className="text-2xl font-semibold">{printing.card.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            <Link
              href={`/${game.slug}/${encodeURIComponent(set.code)}`}
              className="hover:underline"
            >
              {set.name}
            </Link>{" "}
            · {printing.collectorNumber}
            {printing.rarity ? ` · ${printing.rarity.name}` : ""}
          </p>
          {printing.artist ? (
            <p className="mt-1 text-xs text-neutral-400">Illustrated by {printing.artist.name}</p>
          ) : null}
          {printing.card.rulesText ? (
            <p className="mt-4 whitespace-pre-line text-sm">{printing.card.rulesText}</p>
          ) : null}

          <table className="mt-6 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-neutral-500">
                <th className="py-1 font-medium">Finish</th>
                <th className="py-1 font-medium">Value (NM)</th>
                <th className="py-1 font-medium">Cardmarket trend</th>
                <th className="py-1 font-medium">TCGplayer market</th>
                <th className="py-1 font-medium">Owned</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => {
                const cm = latestBySource(v, "CARDMARKET");
                const tp = latestBySource(v, "TCGPLAYER");
                return (
                  <tr key={v.id} className="border-b last:border-b-0">
                    <td className="py-1.5">
                      <FinishBadge finish={v.finish} />
                    </td>
                    <td className="py-1.5">
                      <PriceChip value={values.get(v.id)?.valueEur} />
                    </td>
                    <td className="py-1.5 text-neutral-600">
                      {cm ? fmt(cm.trend ?? cm.mid ?? cm.low, cm.currency) : "—"}
                    </td>
                    <td className="py-1.5 text-neutral-600">
                      {tp ? fmt(tp.market ?? tp.mid ?? tp.low, tp.currency) : "—"}
                    </td>
                    <td className="py-1.5 text-neutral-600">{v._count.collection || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {variants.some((v) => v.priceObs.length > 0) ? (
            <p className="mt-1 text-xs text-neutral-400">
              Prices via TCGdex, updated{" "}
              {new Date(
                Math.max(...variants.flatMap((v) => v.priceObs.map((o) => o.observedAt.getTime()))),
              ).toLocaleDateString()}
              .
            </p>
          ) : (
            <p className="mt-1 text-xs text-neutral-400">
              No prices yet — run a sync from the{" "}
              <Link href="/sync" className="underline">
                Sync
              </Link>{" "}
              page.
            </p>
          )}

          <form action={addToCollection} className="mt-6 flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Add to collection</h2>

            <label className="flex flex-col gap-1 text-sm">
              Variant
              <select name="variantId" className="rounded border px-2 py-1" required>
                {variants.map((variant) => {
                  const value = values.get(variant.id)?.valueEur;
                  return (
                    <option key={variant.id} value={variant.id}>
                      {finishLabel(variant.finish)} · {variant.language.name}
                      {value !== undefined ? ` · ${formatEur(value)}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>

            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Quantity
                <input
                  type="number"
                  name="quantity"
                  min={1}
                  defaultValue={1}
                  className="rounded border px-2 py-1"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Condition
                <select name="condition" className="rounded border px-2 py-1">
                  <option value="">—</option>
                  {CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {condition.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Grading company
                <select name="gradingCompany" className="rounded border px-2 py-1">
                  <option value="">Ungraded</option>
                  {GRADING_COMPANIES.map((company) => (
                    <option key={company} value={company}>
                      {company}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Grade
                <input
                  type="number"
                  name="grade"
                  step={0.5}
                  min={1}
                  max={10}
                  className="rounded border px-2 py-1"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              Price paid per card (€, optional)
              <input
                type="number"
                name="purchasePrice"
                min={0}
                step={0.01}
                className="rounded border px-2 py-1"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Notes
              <input type="text" name="notes" className="rounded border px-2 py-1" />
            </label>

            <button
              type="submit"
              className="mt-2 rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
            >
              Add to collection
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
