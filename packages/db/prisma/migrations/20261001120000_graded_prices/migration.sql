-- Graded-slab asking prices per company and grade (eBay). Additive: a new table.
-- CreateTable
CREATE TABLE "GradedPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variantId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "gradeKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "median" INTEGER NOT NULL,
    "low" INTEGER NOT NULL,
    "listingCount" INTEGER NOT NULL,
    "languageCode" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    CONSTRAINT "GradedPrice_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GradedPrice_variantId_languageCode_company_gradeKey_currency_key" ON "GradedPrice"("variantId", "languageCode", "company", "gradeKey", "currency");

-- CreateIndex
CREATE INDEX "GradedPrice_variantId_idx" ON "GradedPrice"("variantId");
