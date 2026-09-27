-- Hand-written migration. Prisma cannot express partitioning, a plain SQL
-- GIN index, materialized views or RLS policies, so this file does what
-- migration 20260927000000_init could not.
--
-- Assumes it runs immediately after 0001_init on a table with no rows yet
-- (true for a fresh Sprint 1 environment). If this repo ever needs to
-- re-partition a PriceObservation table that already has data, do NOT reuse
-- this file: write a new migration that creates the partitioned table
-- alongside the old one and backfills it, then swaps.

-- =====================================================================
-- 1. Range-partition PriceObservation by month (on observedAt)
-- =====================================================================

ALTER TABLE "PriceObservation" RENAME TO "PriceObservation_unpartitioned";

CREATE TABLE "PriceObservation" (
    "id"             BIGINT NOT NULL DEFAULT nextval('"PriceObservation_id_seq"'),
    "variantId"      TEXT NOT NULL,
    "source"         "PriceSourceKind" NOT NULL,
    "condition"      "Condition",
    "gradingCompany" "GradingCompany",
    "grade"          DECIMAL(3,1),
    "currency"       TEXT NOT NULL,
    "low"            INTEGER,
    "mid"            INTEGER,
    "market"         INTEGER,
    "trend"          INTEGER,
    "sampleSize"     INTEGER,
    "observedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id", "observedAt")
) PARTITION BY RANGE ("observedAt");

ALTER SEQUENCE "PriceObservation_id_seq" OWNED BY "PriceObservation"."id";

DROP TABLE "PriceObservation_unpartitioned";

ALTER TABLE "PriceObservation"
    ADD CONSTRAINT "PriceObservation_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "PrintVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PriceObservation_variantId_observedAt_idx" ON "PriceObservation"("variantId", "observedAt" DESC);

-- Helper that creates (if missing) the monthly partition covering `for_month`.
-- apps/worker's catalog-sync job should call this a couple of months ahead of
-- time; it is idempotent so it is also safe to call from migrations/seeds.
CREATE OR REPLACE FUNCTION ensure_price_observation_partition(for_month DATE)
RETURNS void AS $$
DECLARE
    partition_start DATE := date_trunc('month', for_month);
    partition_end   DATE := date_trunc('month', for_month) + INTERVAL '1 month';
    partition_name  TEXT := 'PriceObservation_y' || to_char(partition_start, 'YYYY') || 'm' || to_char(partition_start, 'MM');
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF "PriceObservation" FOR VALUES FROM (%L) TO (%L)',
            partition_name, partition_start, partition_end
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Bootstrap partitions: 3 months back through 3 months ahead.
DO $$
DECLARE
    i INT;
BEGIN
    FOR i IN -3..3 LOOP
        PERFORM ensure_price_observation_partition((date_trunc('month', now()) + (i || ' month')::interval)::date);
    END LOOP;
END;
$$;

-- =====================================================================
-- 2. Fuzzy search: GIN trigram index on Card.name
-- =====================================================================

CREATE INDEX "Card_name_trgm_idx" ON "Card" USING GIN ("name" gin_trgm_ops);

-- =====================================================================
-- 3. set_completion materialized view
--    One row per (user, set) the user has at least one card from.
--    owned_distinct counts distinct Printings owned; total is the Printing
--    count for that Set, regardless of which finish/edition/language.
-- =====================================================================

CREATE MATERIALIZED VIEW set_completion AS
SELECT
    ci."userId"                              AS user_id,
    p."setId"                                AS set_id,
    COUNT(DISTINCT p."id")                   AS owned_distinct,
    (SELECT COUNT(*) FROM "Printing" p2 WHERE p2."setId" = p."setId")::BIGINT AS total
FROM "CollectionItem" ci
JOIN "PrintVariant" pv ON pv."id" = ci."variantId"
JOIN "Printing" p ON p."id" = pv."printingId"
GROUP BY ci."userId", p."setId";

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX "set_completion_user_id_set_id_idx" ON set_completion (user_id, set_id);

-- The app only ever reads this through Prisma (which bypasses RLS), already
-- filtered by the caller's own userId. Client-side Supabase queries (anon /
-- authenticated roles) must not read it directly, since a materialized view
-- has no RLS of its own to scope it per user.
REVOKE ALL ON set_completion FROM anon, authenticated;

-- =====================================================================
-- 4. Row Level Security
--    auth.uid() returns uuid; User.id/CollectionItem.userId etc. are text,
--    hence the ::text cast on every comparison.
-- =====================================================================

ALTER TABLE "CollectionItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collection_item_owner" ON "CollectionItem"
    USING (auth.uid()::text = "userId")
    WITH CHECK (auth.uid()::text = "userId");

ALTER TABLE "Binder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "binder_owner" ON "Binder"
    USING (auth.uid()::text = "userId")
    WITH CHECK (auth.uid()::text = "userId");

ALTER TABLE "BinderPage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "binder_page_owner" ON "BinderPage"
    USING (EXISTS (
        SELECT 1 FROM "Binder" b WHERE b."id" = "BinderPage"."binderId" AND auth.uid()::text = b."userId"
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM "Binder" b WHERE b."id" = "BinderPage"."binderId" AND auth.uid()::text = b."userId"
    ));

ALTER TABLE "BinderSlot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "binder_slot_owner" ON "BinderSlot"
    USING (EXISTS (
        SELECT 1 FROM "BinderPage" bp
        JOIN "Binder" b ON b."id" = bp."binderId"
        WHERE bp."id" = "BinderSlot"."pageId" AND auth.uid()::text = b."userId"
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM "BinderPage" bp
        JOIN "Binder" b ON b."id" = bp."binderId"
        WHERE bp."id" = "BinderSlot"."pageId" AND auth.uid()::text = b."userId"
    ));

ALTER TABLE "PortfolioSnapshot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portfolio_snapshot_owner" ON "PortfolioSnapshot"
    USING (auth.uid()::text = "userId")
    WITH CHECK (auth.uid()::text = "userId");
