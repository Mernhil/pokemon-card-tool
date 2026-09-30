import { SET_MERGES, SUBSET_RULES, subsetFor } from "@tcg-vault/shared";
import { prisma } from "./client";

/**
 * Startup repairs for subsets (packages/shared/src/subsets.ts), both
 * idempotent and safe to repeat; the catalog sync does the same for every set
 * it writes, these fix what was synced before subsets existed.
 */

/**
 * Moves a stray set's cards into the set they belong to (SET_MERGES), e.g. the
 * Classic Collection that TCGdex lists as its own "30th-c" into "30th".
 * Printings are re-pointed (their ids, variants, collection items, binder
 * slots and price history all hang off the printing/variant ids and so stay
 * intact), set-level references follow, and the emptied set is removed.
 * A printing that would collide with one already in the parent stays put,
 * and then so does the stray set. Returns how many printings moved.
 */
export async function mergeStraySets(): Promise<number> {
  let moved = 0;
  for (const [key, merge] of Object.entries(SET_MERGES)) {
    const [game, code] = key.split(":") as [string, string];
    const [stray, parent] = await Promise.all([
      prisma.set.findFirst({ where: { code, game: { slug: game } }, select: { id: true } }),
      prisma.set.findFirst({ where: { code: merge.into, game: { slug: game } }, select: { id: true } }),
    ]);
    if (!stray || !parent || stray.id === parent.id) continue;

    await prisma.$transaction(async (tx) => {
      const printings = await tx.printing.findMany({
        where: { setId: stray.id },
        select: { id: true, collectorNumber: true, isAltArt: true, sortNumber: true },
      });
      const taken = new Set(
        (
          await tx.printing.findMany({
            where: { setId: parent.id },
            select: { collectorNumber: true, isAltArt: true },
          })
        ).map((p) => `${p.collectorNumber}\u0000${p.isAltArt}`),
      );
      for (const p of printings) {
        if (taken.has(`${p.collectorNumber}\u0000${p.isAltArt}`)) continue;
        await tx.printing.update({
          where: { id: p.id },
          data: {
            setId: parent.id,
            sortNumber: p.sortNumber < merge.sortOffset ? p.sortNumber + merge.sortOffset : p.sortNumber,
          },
        });
        moved++;
      }
      if ((await tx.printing.count({ where: { setId: stray.id } })) > 0) return;
      await tx.externalRef.updateMany({ where: { setId: stray.id }, data: { setId: parent.id } });
      await tx.binder.updateMany({ where: { setId: stray.id }, data: { setId: parent.id } });
      await tx.set.delete({ where: { id: stray.id } });
    });
  }
  return moved;
}

/** Fills Printing.subset for every set that has subset rules. Returns how many rows changed. */
export async function backfillSubsets(): Promise<number> {
  let changed = 0;
  for (const setCode of Object.keys(SUBSET_RULES)) {
    const printings = await prisma.printing.findMany({
      where: { set: { code: setCode } },
      select: {
        id: true,
        collectorNumber: true,
        subset: true,
        rarity: { select: { name: true } },
        card: { select: { name: true } },
      },
    });
    for (const p of printings) {
      const subset = subsetFor({
        setCode,
        collectorNumber: p.collectorNumber,
        rarityName: p.rarity?.name,
        name: p.card.name,
      });
      if (subset === p.subset) continue;
      await prisma.printing.update({ where: { id: p.id }, data: { subset } });
      changed++;
    }
  }
  return changed;
}
