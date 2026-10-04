-- Other-language TCGdex catalogs wrote their card ids under the English source
-- ("tcgdex-pokemon"), taking over English ids that happen to be the same (e.g.
-- "30th-c-001"). English cards then fell back to a guessed id and could be priced
-- as a different card. Move every foreign-language ref to its own per-language
-- source; the English refs are written back by the next English catalog sync.
UPDATE "ExternalRef"
SET "source" = 'tcgdex-pokemon-' || (
  SELECT CASE
    WHEN substr(s."code", 1, 6) = 'zh-cn-' THEN 'zh-cn'
    WHEN substr(s."code", 1, 6) = 'zh-tw-' THEN 'zh-tw'
    ELSE substr(s."code", 1, 2)
  END
  FROM "Printing" p JOIN "Set" s ON s."id" = p."setId"
  WHERE p."id" = "ExternalRef"."printingId"
)
WHERE "source" = 'tcgdex-pokemon'
  AND "externalId" NOT LIKE 'tcgcsv-%'
  AND "printingId" IN (
    SELECT p."id" FROM "Printing" p JOIN "Set" s ON s."id" = p."setId"
    WHERE substr(s."code", 1, 3) IN ('ja-', 'fr-', 'de-', 'it-', 'es-', 'pt-', 'ko-', 'id-', 'th-')
       OR substr(s."code", 1, 6) IN ('zh-cn-', 'zh-tw-')
  );

-- The 30th Celebration Classic Collection (001/30 …) was priced from the main set's
-- card with the same number (Charizard showed Exeggcute's 3 cent Cardmarket price).
-- Drop those wrong observations and the valuations built on them.
DELETE FROM "PriceObservation"
WHERE "provider" IN ('cardmarket', 'tcgplayer')
  AND "observedAt" >= 1790985600000
  AND "variantId" IN (
    SELECT v."id" FROM "PrintVariant" v
    JOIN "Printing" p ON p."id" = v."printingId"
    JOIN "Set" s ON s."id" = p."setId"
    WHERE s."code" = '30th' AND p."collectorNumber" LIKE '%/30'
  );
DELETE FROM "VariantValuation"
WHERE "day" >= 1790985600000
  AND "variantId" IN (
    SELECT v."id" FROM "PrintVariant" v
    JOIN "Printing" p ON p."id" = v."printingId"
    JOIN "Set" s ON s."id" = p."setId"
    WHERE s."code" = '30th' AND p."collectorNumber" LIKE '%/30'
  );
