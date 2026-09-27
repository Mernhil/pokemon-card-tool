/** SEO-indexable card page: one Printing, its variants, prices and marketplace links. */
export default function CardPage({
  params,
}: {
  params: { game: string; set: string; number: string };
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-semibold">
        {params.game} / {params.set} / {params.number}
      </h1>
      {/* TODO(sprint 3+6): PriceBlock, VariantPicker, CardViewer */}
    </main>
  );
}
