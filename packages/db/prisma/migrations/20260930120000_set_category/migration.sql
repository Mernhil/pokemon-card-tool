-- Set categories (main / promo / mcdonalds / trainer-kit / pocket / other).
-- Additive: existing sets default to "main"; the app backfills the real
-- category at startup (backfillSetCategories) and on every catalog sync.
-- AlterTable
ALTER TABLE "Set" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'main';

-- CreateIndex
CREATE INDEX "Set_gameId_category_idx" ON "Set"("gameId", "category");
