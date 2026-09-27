-- Hand-written pieces Prisma cannot express (run after `prisma migrate deploy`).

-- ---------------------------------------------------------------------------
-- 1. Monthly range partitioning of PriceObservation, the largest table by far.
--    Prisma creates the table un-partitioned on first migrate; this block is a
--    one-time conversion. On a fresh database, drop/recreate as partitioned
--    from the start instead.
-- ---------------------------------------------------------------------------
-- Example for a fresh setup (adjust bounds as needed when adding months):
-- CREATE TABLE "PriceObservation" (
--   LIKE "PriceObservation_template" INCLUDING ALL
-- ) PARTITION BY RANGE ("observedAt");
--
-- CREATE TABLE "PriceObservation_2026_09" PARTITION OF "PriceObservation"
--   FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
-- CREATE TABLE "PriceObservation_2026_10" PARTITION OF "PriceObservation"
--   FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
-- (the sync-prices worker job creates the next month's partition ahead of time)

-- ---------------------------------------------------------------------------
-- 2. GIN trigram index on Card.name for fuzzy search fallback.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Card_name_trgm_idx"
  ON "Card" USING GIN ("name" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. Materialized view: set completion per user, refreshed after inventory writes.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS set_completion AS
SELECT
  ci."userId"                    AS user_id,
  p."setId"                      AS set_id,
  COUNT(DISTINCT p.id)           AS owned_distinct,
  (SELECT COUNT(*) FROM "Printing" p2 WHERE p2."setId" = p."setId") AS total
FROM "CollectionItem" ci
JOIN "PrintVariant" pv ON pv.id = ci."variantId"
JOIN "Printing" p ON p.id = pv."printingId"
GROUP BY ci."userId", p."setId";

CREATE UNIQUE INDEX IF NOT EXISTS set_completion_user_set_idx
  ON set_completion (user_id, set_id);

-- Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY set_completion;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security: user-owned tables restricted to auth.uid().
-- ---------------------------------------------------------------------------
ALTER TABLE "CollectionItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Binder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BinderPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BinderSlot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortfolioSnapshot" ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_item_owner ON "CollectionItem"
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY binder_owner ON "Binder"
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY binder_page_owner ON "BinderPage"
  USING (EXISTS (
    SELECT 1 FROM "Binder" b WHERE b.id = "BinderPage"."binderId" AND b."userId" = auth.uid()::text
  ));

CREATE POLICY binder_slot_owner ON "BinderSlot"
  USING (EXISTS (
    SELECT 1 FROM "BinderPage" bp
    JOIN "Binder" b ON b.id = bp."binderId"
    WHERE bp.id = "BinderSlot"."pageId" AND b."userId" = auth.uid()::text
  ));

CREATE POLICY portfolio_snapshot_owner ON "PortfolioSnapshot"
  USING ("userId" = auth.uid()::text);
