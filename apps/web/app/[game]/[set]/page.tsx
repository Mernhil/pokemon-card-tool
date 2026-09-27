export default function SetCardGridPage({ params }: { params: { game: string; set: string } }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">
        {params.game} / {params.set}
      </h1>
      {/* TODO(sprint 3): card grid + filters by rarity/finish/language, SQLite-backed */}
    </main>
  );
}
