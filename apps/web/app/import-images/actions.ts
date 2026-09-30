"use server";

import { matchImageFiles, prisma, type ImportMatch } from "@tcg-vault/db";

/** Which file would go to which card of this set (nothing is saved). */
export async function previewImageImportAction(
  setId: number,
  fileNames: string[],
): Promise<ImportMatch[]> {
  const printings = await prisma.printing.findMany({
    where: { setId },
    select: { id: true, collectorNumber: true, card: { select: { name: true } } },
  });
  return matchImageFiles(
    fileNames.slice(0, 2_000).map((name) => ({ name })),
    printings.map((p) => ({ id: p.id, collectorNumber: p.collectorNumber, cardName: p.card.name })),
  );
}
