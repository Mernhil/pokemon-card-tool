-- CardTrader matching now goes by the ids TCGdex links to each card (the CardTrader
-- blueprint itself, or the Cardmarket / TCGplayer product CardTrader lists on it) before
-- set names, keeps English cards out of CardTrader's Japanese and patterned reverse holo
-- expansions, and finds a foreign card's English counterpart even inside a merged set.
-- Earlier automatic matches often picked the wrong expansion, so all of them are redone,
-- and the CardTrader listings recorded through them (likely another card's) are dropped.
-- Manual overrides and their prices are kept.
DELETE FROM "PriceObservation"
WHERE ("provider" = 'cardtrader' OR ("provider" IS NULL AND "source" = 'CARDTRADER'))
  AND "variantId" NOT IN (
    SELECT "variantId" FROM "ProviderMapping"
    WHERE "provider" = 'cardtrader' AND "manualOverride" = 1
  );

DELETE FROM "ProviderMapping"
WHERE "provider" = 'cardtrader' AND "manualOverride" = 0;

-- Run every queued CardTrader item again so the new matches are made on the next refresh.
UPDATE "SyncState"
SET "status" = 'pending', "attemptCount" = 0, "lastError" = NULL
WHERE "job" = 'price:cardtrader' AND "status" IN ('done', 'failed', 'unavailable');
