-- ============================================================================
-- 20260720_04_crd_bag_category_updates.sql
-- Purpose: CRD Bag category migration for Sacred Relic and Supreme Relic
--          (spec sections 6-7; manual-SQL list items 6-8).
--
--          *** THIS SCRIPT IS A DOCUMENTED DATA NO-OP. ***
--
--          In this project, bag categories are CODE-side arrays
--          (src/engine/bagViews.js CHESTS / RELICS / CRD Bag Items), not
--          database rows. Sacred Relic and Supreme Relic are stored as the
--          users_bag.sacred_relics and users_bag.supreme_relics integer
--          columns, and their user-facing IDs remain `sr` and `supr`.
--          "Moving" them from CRD Bag Chests to CRD Bag Items is therefore a
--          pure code/display change: no rows move, no IDs change, no
--          duplicate inventory records are possible, and every user quantity
--          is preserved by construction.
-- Affected tables: NONE (validation queries only).
-- Safe to rerun: YES (read-only).
-- ============================================================================

-- Validation 1: relic quantities are intact (record these totals before and
-- after deploying the bag-category code change; they must be identical).
SELECT COUNT(*)            AS bag_rows,
       SUM(sacred_relics)  AS total_sacred_relics,
       SUM(supreme_relics) AS total_supreme_relics
  FROM public.users_bag;

-- Validation 2: exactly one bag row per user (duplicate inventory records
-- are impossible — discord_id is the users_bag primary key).
SELECT discord_id, COUNT(*)
  FROM public.users_bag
 GROUP BY discord_id
HAVING COUNT(*) > 1;   -- must return zero rows

-- Validation 3: no orphan negative quantities.
SELECT COUNT(*) AS negative_rows
  FROM public.users_bag
 WHERE sacred_relics < 0 OR supreme_relics < 0;   -- must be 0

-- Notes:
-- * The Character Class Change item (`cc` -> users_bag.change_class) is added
--   by 20260720_03_crd_inventory_columns.sql.
-- * Genesis Chest keeps no CRD Shop price (spec) and Diamond Chest is added
--   as users_bag.diamond_chest by the same script.
