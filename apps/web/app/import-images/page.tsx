import { prisma } from "@tcg-vault/db";
import { PageHeader } from "../../components/ui/page-header";
import { ImportImagesForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function ImportImagesPage() {
  const sets = await prisma.set.findMany({
    orderBy: [{ game: { slug: "asc" } }, { releaseDate: "desc" }],
    select: { id: true, name: true, code: true, game: { select: { name: true } } },
  });
  return (
    <main className="page max-w-3xl">
      <PageHeader
        eyebrow="Catalog"
        title="Import images from a folder"
        subtitle="For cards no source has a scan of. Name each file after its collector number (004.png, 4.jpg, TG05.webp), pick the set and the folder, check the preview, then save. Imported images are kept when the catalog re-syncs."
      />
      <ImportImagesForm
        sets={sets.map((s) => ({ id: s.id, label: `${s.name} (${s.game.name} · ${s.code})` }))}
      />
    </main>
  );
}
