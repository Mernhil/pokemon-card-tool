import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-3xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-4xl font-bold">TCG Vault</h1>
      <p className="text-lg text-neutral-500">
        Track your Pokémon, Yu-Gi-Oh! and One Piece collection, see it in 3D, and watch its value
        over time.
      </p>
      <div className="mt-4 flex gap-3">
        <Link
          href="/browse"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 hover:bg-neutral-700"
        >
          Browse the catalog
        </Link>
        <Link
          href="/collection"
          className="rounded border px-4 py-2 text-sm font-medium hover:border-neutral-400"
        >
          My collection
        </Link>
      </div>
    </main>
  );
}
