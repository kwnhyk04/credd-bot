-- ============================================================================
-- 20260720_02_crd_shop_tracking.sql
-- Purpose: database-backed CRD Shop purchase-limit tracking (spec section 5).
--          Aggregated quantity per (user, product, reset period) — modeled on
--          the existing pvp_shop_purchases table, but keyed by time period
--          instead of season.
-- Affected tables: NEW public.crd_shop_purchases
-- Safe to rerun: YES (pure IF NOT EXISTS; no data changes).
-- Run BEFORE deploying the CRD Shop code.
-- ============================================================================

-- Preview: confirm the table does not exist yet.
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'crd_shop_purchases';

BEGIN;

-- period_key encoding (all Asia/Manila / PHT — the project convention):
--   daily   products: YYYYMMDD  of (NOW() AT TIME ZONE 'Asia/Manila')::date
--   weekly  products: year*100 + ISO week (same integer as the phtWeek()
--                     helper in src/config/ranked.js; Monday PHT boundary)
--   monthly products: YYYYMM    of the PHT calendar month
-- Each product has exactly one period type, so a single integer column
-- disambiguates. qty is the aggregated total purchased in the period
-- (limits count quantity, not command invocations).
CREATE TABLE IF NOT EXISTS public.crd_shop_purchases (
    discord_id  character varying(20) NOT NULL,
    product_id  smallint NOT NULL,
    period_key  integer NOT NULL,
    qty         integer NOT NULL DEFAULT 0,
    updated_at  timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crd_shop_purchases_pkey PRIMARY KEY (discord_id, product_id, period_key),
    CONSTRAINT crd_shop_purchases_qty_check CHECK (qty >= 0)
);

COMMIT;

-- Validation: table + PK exist.
SELECT c.conname, c.conrelid::regclass AS table_name
  FROM pg_constraint c
 WHERE c.conname = 'crd_shop_purchases_pkey';

-- Notes:
-- * The PK covers the only query shape the shop uses
--   (WHERE discord_id = $1 AND product_id = $2 AND period_key = $3 FOR UPDATE);
--   no additional index is required.
-- * Old-period rows are tiny (one per user/product/period actually purchased)
--   and are useful audit history; no cleanup job is required. They can be
--   pruned manually later with: DELETE FROM crd_shop_purchases WHERE period_key < ...;
-- * Rollback: see 20260720_09_rollback.sql.
