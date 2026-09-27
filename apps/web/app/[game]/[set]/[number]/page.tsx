import { notFound } from "next/navigation";
import { prisma } from "@tcg-vault/db";
import { mediaUrl } from "@tcg-vault/shared";
import { CONDITIONS, GRADING_COMPANIES } from "@tcg-vault/shared";
import { addToCollection } from "../../../actions";

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

  const sortNumber = parseInt(params.number, 10);
  const printing = await prisma.printing.findFirst({
    where: { setId: set.id, sortNumber },
    include: { card: true, rarity: true, artist: true, variants: { include: { language: true } } },
  });
  if (!printing) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <div className="flex flex-col gap-8 sm:flex-row">
        {printing.imageKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(printing.imageKey)}
            alt={printing.card.name}
            className="w-56 shrink-0 rounded-lg"
          />
        ) : (
          <div className="aspect-[5/7] w-56 shrink-0 rounded-lg bg-neutral-100" />
        )}

        <div>
          <h1 className="text-2xl font-semibold">{printing.card.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {set.name} · {printing.collectorNumber}
            {printing.rarity ? ` · ${printing.rarity.name}` : ""}
          </p>
          {printing.artist ? (
            <p className="mt-1 text-xs text-neutral-400">Illustrated by {printing.artist.name}</p>
          ) : null}
          {printing.card.rulesText ? (
            <p className="mt-4 whitespace-pre-line text-sm">{printing.card.rulesText}</p>
          ) : null}

          <form action={addToCollection} className="mt-6 flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Add to collection</h2>

            <label className="flex flex-col gap-1 text-sm">
              Variant
              <select name="variantId" className="rounded border px-2 py-1" required>
                {printing.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.finish.replaceAll("_", " ")} · {variant.edition.replaceAll("_", " ")} ·{" "}
                    {variant.language.name}
                  </option>
                ))}
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
                <input type="number" name="grade" step={0.5} min={1} max={10} className="rounded border px-2 py-1" />
              </label>
            </div>

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
