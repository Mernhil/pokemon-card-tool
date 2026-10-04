import { NextResponse } from "next/server";
import { collectionItemValue, latestValuations, prisma } from "@tcg-vault/db";
import { toCsv } from "@tcg-vault/shared";

export const dynamic = "force-dynamic";

/** Your whole collection as a CSV file (values in EUR, prices in major units). */
export async function GET() {
  const items = await prisma.collectionItem.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      variant: {
        include: { printing: { include: { card: true, rarity: true, set: true } } },
      },
    },
  });
  const values = await latestValuations(items.map((i) => i.variantId));
  const eur = (minor: number | null | undefined) =>
    minor === null || minor === undefined ? "" : (minor / 100).toFixed(2);

  const csv = toCsv(
    [
      "Set",
      "Number",
      "Name",
      "Rarity",
      "Finish",
      "Edition",
      "Language",
      "Quantity",
      "Condition",
      "Grading company",
      "Grade",
      "Cert number",
      "Paid per card",
      "Paid currency",
      "Acquired",
      "Value (EUR, whole entry)",
      "Notes",
    ],
    items.map((i) => {
      const p = i.variant.printing;
      return [
        p.set.name,
        p.collectorNumber,
        p.card.name,
        p.rarity?.name ?? "",
        i.variant.finish,
        i.variant.edition,
        i.variant.languageCode,
        i.quantity,
        i.condition ?? "",
        i.gradingCompany ?? "",
        i.grade ?? "",
        i.certNumber ?? "",
        eur(i.purchasePrice),
        i.purchaseCurrency ?? "",
        i.acquiredAt ? i.acquiredAt.toISOString().slice(0, 10) : "",
        eur(collectionItemValue(values.get(i.variantId)?.valueEur, i)),
        i.notes ?? "",
      ];
    }),
  );

  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tcg-vault-collection-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
