-- ============================================================================
-- 20260720_03_crd_inventory_columns.sql
-- Purpose: inventory support for the Character Class Change item, Diamond
--          Chest, and Genesis Chest (spec sections 5-7, 10). Stackable items
--          live as integer columns on users_bag in this project.
-- Affected tables: public.users_bag (ADD COLUMN only)
-- Safe to rerun: YES (ADD COLUMN IF NOT EXISTS; preserves every existing
--                balance and quantity — no rows are touched).
-- Run BEFORE deploying the CRD Shop / CRD Bag / crd use code
-- (schemaGuard checks these columns).
-- ============================================================================

-- Preview: current users_bag columns (the three new ones should be absent).
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users_bag'
   AND column_name IN ('change_class', 'diamond_chest', 'genesis_chest');

BEGIN;

ALTER TABLE public.users_bag
  ADD COLUMN IF NOT EXISTS change_class  integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS diamond_chest integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS genesis_chest integer DEFAULT 0 NOT NULL;

COMMIT;

-- Validation: all three columns exist with default 0.
SELECT column_name, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users_bag'
   AND column_name IN ('change_class', 'diamond_chest', 'genesis_chest');

-- Validation: no user balance was modified (spot check totals are unchanged
-- from before the migration — pure ADD COLUMN cannot modify them).
SELECT COUNT(*)            AS bag_rows,
       SUM(credux)         AS total_credux,
       SUM(sacred_relics)  AS total_sacred_relics,
       SUM(supreme_relics) AS total_supreme_relics
  FROM public.users_bag;

-- Notes:
-- * Column names follow the existing bag style (silver_chest, sacred_relics).
-- * change_class is the inventory item granted by CRD Shop product 1 and
--   consumed by `crd use cc`.
-- * Rollback: see 20260720_09_rollback.sql (DROP COLUMN destroys quantities —
--   preview totals there first).
