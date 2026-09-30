-- National Pokedex ids per card, for exact "all cards of this Pokemon" searches.
-- Additive: a new table; the app fills it in at startup (backfillCardDex) and on every catalog sync.
-- CreateTable
CREATE TABLE "CardDex" (
    "cardId" TEXT NOT NULL,
    "dexId" INTEGER NOT NULL,

    PRIMARY KEY ("cardId", "dexId"),
    CONSTRAINT "CardDex_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CardDex_dexId_idx" ON "CardDex"("dexId");
