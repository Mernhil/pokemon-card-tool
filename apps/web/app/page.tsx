import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 p-24 text-center">
      <h1 className="text-4xl font-bold">TCG Vault</h1>
      <p className="text-neutral-400">
        Track your Pokémon, Yu-Gi-Oh! and One Piece cards - condition, grading, language, binders
        and portfolio value in one place.
      </p>
      <div className="flex gap-4">
        <Link href="/login" className="rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500">
          Log in
        </Link>
        <Link href="/signup" className="rounded border border-neutral-700 px-4 py-2 hover:bg-neutral-900">
          Sign up
        </Link>
      </div>
    </main>
  );
}
