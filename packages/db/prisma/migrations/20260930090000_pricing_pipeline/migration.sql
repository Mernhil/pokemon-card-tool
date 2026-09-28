-- Pricing pipeline: provider mappings, one-number-per-row price observations,
-- provider health, settings, recently viewed cards, exchange rates.
-- Additive only (new tables, new nullable columns): existing rows, including
-- price history, are kept as they are.
-- AlterTable
ALTER TABLE "PriceObservation" ADD COLUMN "amount" INTEGER;
ALTER TABLE "PriceObservation" ADD COLUMN "kind" TEXT;
ALTER TABLE "PriceObservation" ADD COLUMN "listingCount" INTEGER;
ALTER TABLE "PriceObservation" ADD COLUMN "payloadHash" TEXT;
ALTER TABLE "PriceObservation" ADD COLUMN "provider" TEXT;

-- CreateTable
CREATE TABLE "ProviderMapping" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "variantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "query" TEXT,
    "url" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'matched',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "resolvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderMapping_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderStatus" (
    "provider" TEXT NOT NULL PRIMARY KEY,
    "lastSuccessAt" DATETIME,
    "lastErrorAt" DATETIME,
    "lastError" TEXT,
    "rateLimitedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CardView" (
    "printingId" TEXT NOT NULL PRIMARY KEY,
    "lastViewedAt" DATETIME NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "currency" TEXT NOT NULL PRIMARY KEY,
    "perEur" REAL NOT NULL,
    "asOf" DATETIME NOT NULL,
    "source" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "ProviderMapping_provider_status_idx" ON "ProviderMapping"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderMapping_variantId_provider_key" ON "ProviderMapping"("variantId", "provider");

-- CreateIndex
CREATE INDEX "CardView_lastViewedAt_idx" ON "CardView"("lastViewedAt");

-- CreateIndex
CREATE INDEX "PriceObservation_variantId_provider_observedAt_idx" ON "PriceObservation"("variantId", "provider", "observedAt" DESC);


-- Existing TCGdex-sourced rows keep their low/mid/market/trend columns (read
-- via normalizeObservation); tagging their provider lets per-provider
-- queries include that history.
UPDATE "PriceObservation" SET "provider" = lower("source") WHERE "provider" IS NULL AND "source" IN ('CARDMARKET', 'TCGPLAYER');
