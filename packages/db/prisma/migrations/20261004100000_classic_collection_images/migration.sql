-- The 30th Celebration Classic Collection (001/30 …) has no scan on TCGdex and was shown
-- the main set's card with the same number (Charizard showed Exeggcute). Forget those
-- cached pictures: the card now shows the missing-image tile until a real scan exists.
DELETE FROM "ImageCacheEntry"
WHERE "printingId" IN (
  SELECT p."id" FROM "Printing" p
  JOIN "Set" s ON s."id" = p."setId"
  WHERE s."code" = '30th' AND p."collectorNumber" LIKE '%/30'
    AND (p."imageUrls" IS NULL OR p."imageUrls" = '' OR p."imageUrls" = '[]')
);
