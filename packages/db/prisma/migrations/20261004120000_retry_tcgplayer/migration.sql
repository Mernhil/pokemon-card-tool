-- TCGplayer prices can now also come from tcgcsv for English cards TCGdex has no price for.
-- Drop the earlier "not found" TCGplayer results so they are looked up again on the next refresh.
-- Manual overrides are kept.
DELETE FROM "ProviderMapping"
WHERE "provider" = 'tcgplayer' AND "status" = 'not_found' AND "manualOverride" = 0;
