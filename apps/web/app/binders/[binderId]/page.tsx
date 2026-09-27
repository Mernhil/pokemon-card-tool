export default function BinderDetailPage({ params }: { params: { binderId: string } }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Binder {params.binderId}</h1>
      {/* TODO(sprint 5): BinderSpread + BinderPage + dnd-kit Slot grid */}
    </main>
  );
}
