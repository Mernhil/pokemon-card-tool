import Link from "next/link";

export default function BindersPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Binders</h1>
      <p className="mt-4 text-neutral-500">
        Virtual binders are coming soon. For now, everything you own is on the{" "}
        <Link href="/collection" className="underline">
          Collection
        </Link>{" "}
        page.
      </p>
      {/* TODO(sprint 5): binder list, create/rename, grid size picker */}
    </main>
  );
}
