-- Japanese sets now take the cards TCGdex lists the set for but has no entry of (whole eras:
-- ADV, DP, BW, ... came with no cards at all) from TCGplayer's catalog via tcgcsv. Sync every
-- Japanese set again on the next run instead of waiting for the 30-day refresh.
UPDATE "SyncState"
SET "status" = 'pending', "attemptCount" = 0, "lastError" = NULL
WHERE "job" = 'catalog' AND "game" = 'pokemon' AND "itemKey" LIKE 'ja-%'
  AND "status" IN ('done', 'failed', 'unavailable');
