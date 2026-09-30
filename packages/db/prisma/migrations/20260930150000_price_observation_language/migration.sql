-- Which language a price is for. Null = the source cannot split by language (Cardmarket and
-- TCGplayer via TCGdex) or the listing did not say. Additive: a nullable column, no table rebuild.
-- AlterTable
ALTER TABLE "PriceObservation" ADD COLUMN "languageCode" TEXT;

-- CardTrader and eBay rows written so far were filtered to the variant language, so that is
-- the language they are for.
UPDATE "PriceObservation" SET "languageCode" = (SELECT v."languageCode" FROM "PrintVariant" v WHERE v."id" = "PriceObservation"."variantId") WHERE "provider" IN ('cardtrader', 'ebay') AND "languageCode" IS NULL;
