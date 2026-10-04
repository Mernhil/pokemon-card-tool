-- CardTrader matching now also tries the English set name and parent/child expansion names
-- (an Italian or Japanese card's set is "Astral Radiance" there). Drop the earlier "not found"
-- results so they are matched again on the next refresh. Manual overrides are kept.
DELETE FROM "ProviderMapping"
WHERE "provider" = 'cardtrader' AND "status" = 'not_found' AND "manualOverride" = 0;
