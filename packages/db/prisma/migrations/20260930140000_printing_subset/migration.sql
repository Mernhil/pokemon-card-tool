-- Subsets inside a set (e.g. Special Art in the 30th Celebration). Additive: a
-- new nullable column; the app fills it in at startup (backfillSubsets) and
-- on every catalog sync.
-- AlterTable
ALTER TABLE "Printing" ADD COLUMN "subset" TEXT;

-- CreateIndex
CREATE INDEX "Printing_setId_subset_idx" ON "Printing"("setId", "subset");
