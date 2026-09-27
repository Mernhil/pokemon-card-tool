-- CreateTable
CREATE TABLE "Game" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Language" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Set" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "series" TEXT,
    "type" TEXT NOT NULL DEFAULT 'MAIN',
    "primaryLangCode" TEXT,
    "releaseDate" DATETIME,
    "printedTotal" INTEGER,
    "totalCards" INTEGER,
    "logoUrl" TEXT,
    "symbolUrl" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Set_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Set_primaryLangCode_fkey" FOREIGN KEY ("primaryLangCode") REFERENCES "Language" ("code") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rarity" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "defaultFinish" TEXT NOT NULL DEFAULT 'NON_FOIL',
    CONSTRAINT "Rarity_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "cardType" TEXT NOT NULL,
    "subtypes" TEXT NOT NULL DEFAULT '[]',
    "rulesText" TEXT,
    "flavorText" TEXT,
    "attributes" TEXT NOT NULL DEFAULT '{}',
    "canonicalKey" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Card_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Printing" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "Printing_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Printing_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Printing_rarityId_fkey" FOREIGN KEY ("rarityId") REFERENCES "Rarity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Printing_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrintVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "printingId" TEXT NOT NULL,
    "finish" TEXT NOT NULL DEFAULT 'NON_FOIL',
    "edition" TEXT NOT NULL DEFAULT 'UNLIMITED',
    "languageCode" TEXT NOT NULL,
    "foilProfileId" INTEGER,
    "imageKey" TEXT,
    CONSTRAINT "PrintVariant_printingId_fkey" FOREIGN KEY ("printingId") REFERENCES "Printing" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PrintVariant_languageCode_fkey" FOREIGN KEY ("languageCode") REFERENCES "Language" ("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PrintVariant_foilProfileId_fkey" FOREIGN KEY ("foilProfileId") REFERENCES "FoilProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FoilProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "shader" TEXT NOT NULL,
    "params" TEXT NOT NULL DEFAULT '{}',
    "foilMaskKey" TEXT,
    "normalMapKey" TEXT
);

-- CreateTable
CREATE TABLE "ExternalRef" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "setId" INTEGER,
    "cardId" TEXT,
    "printingId" TEXT,
    CONSTRAINT "ExternalRef_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExternalRef_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExternalRef_printingId_fkey" FOREIGN KEY ("printingId") REFERENCES "Printing" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "condition" TEXT,
    "gradingCompany" TEXT,
    "grade" REAL,
    "certNumber" TEXT,
    "purchasePrice" INTEGER,
    "purchaseCurrency" TEXT,
    "acquiredAt" DATETIME,
    "notes" TEXT,
    "photoKeys" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollectionItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Binder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "coverKey" TEXT,
    "rows" INTEGER NOT NULL DEFAULT 3,
    "cols" INTEGER NOT NULL DEFAULT 3,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BinderPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "binderId" TEXT NOT NULL,
    "pageIndex" INTEGER NOT NULL,
    CONSTRAINT "BinderPage_binderId_fkey" FOREIGN KEY ("binderId") REFERENCES "Binder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BinderSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "collectionItemId" TEXT,
    "placeholderVariantId" TEXT,
    CONSTRAINT "BinderSlot_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BinderPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BinderSlot_collectionItemId_fkey" FOREIGN KEY ("collectionItemId") REFERENCES "CollectionItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketplaceMapping" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "variantId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT,
    "confidence" REAL NOT NULL DEFAULT 1,
    CONSTRAINT "MarketplaceMapping_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceObservation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "variantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "condition" TEXT,
    "gradingCompany" TEXT,
    "grade" REAL,
    "currency" TEXT NOT NULL,
    "low" INTEGER,
    "mid" INTEGER,
    "market" INTEGER,
    "trend" INTEGER,
    "sampleSize" INTEGER,
    "observedAt" DATETIME NOT NULL,
    CONSTRAINT "PriceObservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaleRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "variantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "condition" TEXT,
    "gradingCompany" TEXT,
    "grade" REAL,
    "price" INTEGER NOT NULL,
    "shipping" INTEGER,
    "currency" TEXT NOT NULL,
    "soldAt" DATETIME NOT NULL,
    "url" TEXT,
    "matchScore" REAL NOT NULL,
    CONSTRAINT "SaleRecord_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VariantValuation" (
    "variantId" TEXT NOT NULL,
    "day" DATETIME NOT NULL,
    "bucket" TEXT NOT NULL,
    "valueEur" INTEGER NOT NULL,
    "valueUsd" INTEGER NOT NULL,
    "confidence" REAL NOT NULL,

    PRIMARY KEY ("variantId", "day", "bucket"),
    CONSTRAINT "VariantValuation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PrintVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "day" DATETIME NOT NULL PRIMARY KEY,
    "currency" TEXT NOT NULL,
    "totalValue" INTEGER NOT NULL,
    "costBasis" INTEGER,
    "itemCount" INTEGER NOT NULL,
    "breakdown" TEXT NOT NULL
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
CREATE INDEX "CollectionItem_variantId_idx" ON "CollectionItem"("variantId");

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
