-- Price alerts ("tell me when this card goes above / below X"). Additive: a new table.
-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variantId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "thresholdEur" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggeredAt" DATETIME,
    "triggeredValueEur" INTEGER,
    CONSTRAINT "PriceAlert_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PriceAlert_variantId_idx" ON "PriceAlert"("variantId");
