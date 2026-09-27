"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@tcg-vault/db";

export async function addToCollection(formData: FormData) {
  const variantId = String(formData.get("variantId") ?? "");
  if (!variantId) throw new Error("Missing variantId");

  const quantity = Math.max(1, Math.floor(Number(formData.get("quantity") ?? 1) || 1));
  const condition = String(formData.get("condition") ?? "") || null;
  const gradingCompany = String(formData.get("gradingCompany") ?? "") || null;
  const gradeRaw = String(formData.get("grade") ?? "");
  const grade = gradeRaw ? Number(gradeRaw) : null;
  const notes = String(formData.get("notes") ?? "") || null;
  const paidRaw = String(formData.get("purchasePrice") ?? "").replace(",", ".");
  const paid = paidRaw ? Math.round(Number(paidRaw) * 100) : null;
  const purchasePrice = paid !== null && Number.isFinite(paid) && paid >= 0 ? paid : null;

  await prisma.collectionItem.create({
    data: {
      variantId,
      quantity,
      condition: gradingCompany ? null : condition,
      gradingCompany,
      grade: gradingCompany ? grade : null,
      notes,
      purchasePrice,
      purchaseCurrency: purchasePrice !== null ? "EUR" : null,
      acquiredAt: new Date(),
    },
  });

  // Card page's "Owned" column, the collection list and the dashboard all change.
  revalidatePath("/", "layout");
}

export async function updateCollectionItemQuantity(id: string, quantity: number) {
  if (quantity <= 0) {
    await prisma.collectionItem.delete({ where: { id } });
  } else {
    await prisma.collectionItem.update({ where: { id }, data: { quantity } });
  }
  revalidatePath("/collection");
}

export async function deleteCollectionItem(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id");
  await prisma.collectionItem.delete({ where: { id } });
  revalidatePath("/", "layout");
}
