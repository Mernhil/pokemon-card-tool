-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "Condition" AS ENUM ('MINT', 'NEAR_MINT', 'LIGHTLY_PLAYED', 'MODERATELY_PLAYED', 'HEAVILY_PLAYED', 'DAMAGED');

-- CreateEnum
CREATE TYPE "Finish" AS ENUM ('NON_FOIL', 'HOLO', 'REVERSE_HOLO', 'COSMOS_HOLO', 'CRACKED_ICE', 'FULL_ART_TEXTURED', 'RAINBOW', 'GOLD', 'ETCHED', 'PARALLEL', 'SECRET_TEXTURED', 'ULTIMATE', 'GHOST', 'STARLIGHT', 'QUARTER_CENTURY', 'PRISMATIC', 'OTHER');

-- CreateEnum
CREATE TYPE "Edition" AS ENUM ('UNLIMITED', 'FIRST_EDITION', 'SHADOWLESS', 'LIMITED', 'PROMO', 'STAFF', 'PRERELEASE');

-- CreateEnum
CREATE TYPE "GradingCompany" AS ENUM ('PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'OTHER');

-- CreateEnum
CREATE TYPE "SetType" AS ENUM ('MAIN', 'EXPANSION', 'SPECIAL', 'STARTER_DECK', 'PROMO', 'TIN_OR_COLLECTION', 'TOURNAMENT');

-- CreateEnum
CREATE TYPE "PriceSourceKind" AS ENUM ('CARDMARKET', 'CARDTRADER', 'TCGPLAYER', 'EBAY_SOLD', 'AGGREGATOR', 'MANUAL');

-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('CARDMARKET', 'CARDTRADER', 'EBAY', 'TCGPLAYER');

-- CreateTable
CREATE TABLE "Game" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Language" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Set" (
    "id" SERIAL NOT NULL,
    "gameId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "series" TEXT,
    "type" "SetType" NOT NULL DEFAULT 'MAIN',
    "primaryLangCode" TEXT,
    "releaseDate" DATE,
    "printedTotal" INTEGER,
    "totalCards" INTEGER,
    "logoUrl" TEXT,
    "symbolUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rarity" (
    "id" SERIAL NOT NULL,
    "gameId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "defaultFinish" "Finish" NOT NULL DEFAULT 'NON_FOIL',

    CONSTRAINT "Rarity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" SERIAL NOT NULL,
    "name" CITEXT NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "gameId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "cardType" TEXT NOT NULL,
    "subtypes" TEXT[],
    "rulesText" TEXT,
    "flavorText" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "canonicalKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Printing" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "setId" INTEGER NOT NULL,
    "collectorNumber" TEXT NOT NULL,
    "sortNumber" INTEGER NOT NULL,
    "rarityId" INTEGER,
    "artistId" INTEGER,
    "isAltArt" BOOLEAN NOT NULL DEFAULT false,
    "imageKey" TEXT,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,

    CONSTRAINT "Printing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintVariant" (
    "id" TEXT NOT NULL,
    "printingId" TEXT NOT NULL,
    "finish" "Finish" NOT NULL DEFAULT 'NON_FOIL',
    "edition" "Edition" NOT NULL DEFAULT 'UNLIMITED',
    "languageCode" TEXT NOT NULL,
    "foilProfileId" INTEGER,
    "imageKey" TEXT,

    CONSTRAINT "PrintVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoilProfile" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "shader" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "foilMaskKey" TEXT,
    "normalMapKey" TEXT,

    CONSTRAINT "FoilProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalRef" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "setId" INTEGER,
    "cardId" TEXT,
    "printingId" TEXT,

    CONSTRAINT "ExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "handle" CITEXT NOT NULL,
    "displayCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "condition" "Condition",
    "gradingCompany" "GradingCompany",
    "grade" DECIMAL(3,1),
    "certNumber" TEXT,
    "purchasePrice" INTEGER,
    "purchaseCurrency" TEXT,
    "acquiredAt" DATE,
    "notes" TEXT,
    "photoKeys" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Binder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coverKey" TEXT,
    "rows" INTEGER NOT NULL DEFAULT 3,
    "cols" INTEGER NOT NULL DEFAULT 3,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Binder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BinderPage" (
    "id" TEXT NOT NULL,
    "binderId" TEXT NOT NULL,
    "pageIndex" INTEGER NOT NULL,

    CONSTRAINT "BinderPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BinderSlot" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "collectionItemId" TEXT,
    "placeholderVariantId" TEXT,

    CONSTRAINT "BinderSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceMapping" (
    "id" SERIAL NOT NULL,
    "variantId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "MarketplaceMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceObservation" (
    "id" BIGSERIAL NOT NULL,
    "variantId" TEXT NOT NULL,
    "source" "PriceSourceKind" NOT NULL,
    "condition" "Condition",
    "gradingCompany" "GradingCompany",
    "grade" DECIMAL(3,1),
    "currency" TEXT NOT NULL,
    "low" INTEGER,
    "mid" INTEGER,
    "market" INTEGER,
    "trend" INTEGER,
    "sampleSize" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id","observedAt")
);

-- CreateTable
CREATE TABLE "SaleRecord" (
    "id" BIGSERIAL NOT NULL,
    "variantId" TEXT NOT NULL,
    "source" "PriceSourceKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "condition" "Condition",
    "gradingCompany" "GradingCompany",
    "grade" DECIMAL(3,1),
    "price" INTEGER NOT NULL,
    "shipping" INTEGER,
    "currency" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT,
    "matchScore" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SaleRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantValuation" (
    "variantId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "bucket" TEXT NOT NULL,
    "valueEur" INTEGER NOT NULL,
    "valueUsd" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "VariantValuation_pkey" PRIMARY KEY ("variantId","day","bucket")
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "totalValue" INTEGER NOT NULL,
    "costBasis" INTEGER,
    "itemCount" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("userId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "Game_slug_key" ON "Game"("slug");

-- CreateIndex
CREATE INDEX "Set_gameId_releaseDate_idx" ON "Set"("gameId", "releaseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Set_gameId_code_key" ON "Set"("gameId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Rarity_gameId_name_key" ON "Rarity"("gameId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_name_key" ON "Artist"("name");

-- CreateIndex
CREATE INDEX "Card_gameId_name_idx" ON "Card"("gameId", "name");

-- CreateIndex
CREATE INDEX "Card_gameId_cardType_idx" ON "Card"("gameId", "cardType");

-- CreateIndex
CREATE UNIQUE INDEX "Card_gameId_canonicalKey_key" ON "Card"("gameId", "canonicalKey");

-- CreateIndex
CREATE INDEX "Printing_cardId_idx" ON "Printing"("cardId");

-- CreateIndex
CREATE INDEX "Printing_rarityId_idx" ON "Printing"("rarityId");

-- CreateIndex
CREATE UNIQUE INDEX "Printing_setId_collectorNumber_isAltArt_key" ON "Printing"("setId", "collectorNumber", "isAltArt");

-- CreateIndex
CREATE INDEX "PrintVariant_languageCode_idx" ON "PrintVariant"("languageCode");

-- CreateIndex
CREATE UNIQUE INDEX "PrintVariant_printingId_finish_edition_languageCode_key" ON "PrintVariant"("printingId", "finish", "edition", "languageCode");

-- CreateIndex
CREATE UNIQUE INDEX "FoilProfile_slug_key" ON "FoilProfile"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRef_source_externalId_key" ON "ExternalRef"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE INDEX "CollectionItem_userId_variantId_idx" ON "CollectionItem"("userId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionItem_gradingCompany_certNumber_key" ON "CollectionItem"("gradingCompany", "certNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BinderPage_binderId_pageIndex_key" ON "BinderPage"("binderId", "pageIndex");

-- CreateIndex
CREATE UNIQUE INDEX "BinderSlot_pageId_position_key" ON "BinderSlot"("pageId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceMapping_variantId_marketplace_key" ON "MarketplaceMapping"("variantId", "marketplace");

-- CreateIndex
CREATE INDEX "PriceObservation_variantId_observedAt_idx" ON "PriceObservation"("variantId", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "SaleRecord_variantId_soldAt_idx" ON "SaleRecord"("variantId", "soldAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SaleRecord_source_externalId_key" ON "SaleRecord"("source", "externalId");

-- AddForeignKey
ALTER TABLE "Set" ADD CONSTRAINT "Set_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Set" ADD CONSTRAINT "Set_primaryLangCode_fkey" FOREIGN KEY ("primaryLangCode") REFERENCES "Language"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rarity" ADD CONSTRAINT "Rarity_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printing" ADD CONSTRAINT "Printing_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printing" ADD CONSTRAINT "Printing_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printing" ADD CONSTRAINT "Printing_rarityId_fkey" FOREIGN KEY ("rarityId") REFERENCES "Rarity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printing" ADD CONSTRAINT "Printing_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintVariant" ADD CONSTRAINT "PrintVariant_printingId_fkey" FOREIGN KEY ("printingId") REFERENCES "Printing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintVariant" ADD CONSTRAINT "PrintVariant_languageCode_fkey" FOREIGN KEY ("languageCode") REFERENCES "Language"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintVariant" ADD CONSTRAINT "PrintVariant_foilProfileId_fkey" FOREIGN KEY ("foilProfileId") REFERENCES "FoilProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRef" ADD CONSTRAINT "ExternalRef_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRef" ADD CONSTRAINT "ExternalRef_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRef" ADD CONSTRAINT "ExternalRef_printingId_fkey" FOREIGN KEY ("printingId") REFERENCES "Printing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Binder" ADD CONSTRAINT "Binder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinderPage" ADD CONSTRAINT "BinderPage_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "Binder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinderSlot" ADD CONSTRAINT "BinderSlot_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BinderPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinderSlot" ADD CONSTRAINT "BinderSlot_collectionItemId_fkey" FOREIGN KEY ("collectionItemId") REFERENCES "CollectionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceMapping" ADD CONSTRAINT "MarketplaceMapping_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantValuation" ADD CONSTRAINT "VariantValuation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioSnapshot" ADD CONSTRAINT "PortfolioSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

