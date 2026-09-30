"use server";

import { prisma } from "@tcg-vault/db";
import { revalidatePath } from "next/cache";

/** Adds or removes a printing from the wishlist; returns whether it is wishlisted afterwards. */
export async function toggleWishlistAction(
  printingId: string,
): Promise<{ wishlisted: boolean }> {
  const existing = await prisma.wishlistItem.findUnique({ where: { printingId } });
  if (existing) {
    await prisma.wishlistItem.delete({ where: { id: existing.id } });
  } else {
    const printing = await prisma.printing.findUnique({
      where: { id: printingId },
      select: { id: true },
    });
    if (!printing) return { wishlisted: false };
    await prisma.wishlistItem.create({ data: { printingId } });
  }
  revalidatePath("/wishlist");
  revalidatePath("/", "layout");
  return { wishlisted: !existing };
}
