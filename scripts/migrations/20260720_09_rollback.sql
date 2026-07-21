-- ============================================================================
-- 20260720_09_rollback.sql
-- Purpose: manual rollback for the Genesis update migrations (scripts 01-08,
--          the enhancement constraint in script 10, dev grants in 11, and
--          the Genesis post-+10 stat backfill in script 12).
--          Sections are ordered REVERSE of the forward scripts. Run only the
--          sections you need. Every destructive section is preceded by a
--          preview and a snapshot instruction.
-- Safe to rerun: YES (each section is IF EXISTS-guarded), but data removed by
--          a section is gone — snapshot first.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- [12] Restore the former flat +10 ATK for Genesis weapons above +10.
-- Deploy the prior application code with this rollback or future enhancement
-- writes will use the new post-+10 curve again.
-- ---------------------------------------------------------------------------
SELECT uw.weapon_id, wr.name, uw.enhancement - 1 AS display_level,
       uw.curr_atk, floor(uw.base_atk::numeric * 2.0)::integer AS rollback_atk
  FROM public.user_weapons AS uw
  JOIN public.weapon_roster AS wr ON wr.weapon_roster_id = uw.weapon_roster_id
 WHERE wr.tier = 'Genesis'
   AND uw.enhancement BETWEEN 12 AND 21
 ORDER BY uw.enhancement, uw.weapon_id;

BEGIN;
UPDATE public.user_weapons AS uw
   SET curr_atk = floor(uw.base_atk::numeric * 2.0)::integer
  FROM public.weapon_roster AS wr
 WHERE wr.weapon_roster_id = uw.weapon_roster_id
   AND wr.tier = 'Genesis'
   AND uw.enhancement BETWEEN 12 AND 21;
COMMIT;

-- ---------------------------------------------------------------------------
-- [11] Revoke the explicit developer Genesis avatar ownership grants.
-- This leaves the Genesis catalog, supporter balances, and equipped rows alone.
-- Preview first; runtime dev unlocks may recreate current-class dev ownership.
-- ---------------------------------------------------------------------------
SELECT ua.discord_id, ac.avatar_key, ac.class_name, ac.gender, ua.source
  FROM public.user_avatars ua
  JOIN public.avatar_catalog ac ON ac.avatar_id = ua.avatar_id
 WHERE ua.discord_id IN ('980773258238492762', '1508745825315196979')
   AND ua.source = 'dev'
   AND lower(ac.style) = 'genesis'
 ORDER BY ua.discord_id, ac.class_name, ac.gender;

BEGIN;
DELETE FROM public.user_avatars ua
 USING public.avatar_catalog ac
 WHERE ua.avatar_id = ac.avatar_id
   AND ua.discord_id IN ('980773258238492762', '1508745825315196979')
   AND ua.source = 'dev'
   AND lower(ac.style) = 'genesis';
COMMIT;

-- ---------------------------------------------------------------------------
-- [10] Restore the original stored +10 weapon enhancement ceiling.
-- This aborts safely if any Genesis weapon is already above stored 11.
-- Downgrade or otherwise resolve those rows explicitly before retrying.
-- ---------------------------------------------------------------------------
SELECT uw.weapon_id, wr.name, wr.tier, uw.enhancement
  FROM public.user_weapons uw
  JOIN public.weapon_roster wr ON wr.weapon_roster_id = uw.weapon_roster_id
 WHERE uw.enhancement > 11
 ORDER BY uw.enhancement DESC, uw.weapon_id;

BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_weapons WHERE enhancement > 11) THEN
    RAISE EXCEPTION 'Cannot restore +10 ceiling while user_weapons rows exceed stored enhancement 11';
  END IF;

  ALTER TABLE public.user_weapons
    DROP CONSTRAINT IF EXISTS user_weapons_enhancement_check;
  ALTER TABLE public.user_weapons
    ADD CONSTRAINT user_weapons_enhancement_check
    CHECK (enhancement >= 1 AND enhancement <= 11);
END $$;
COMMIT;

-- ---------------------------------------------------------------------------
-- [08] Genesis weapons — remove the five roster rows.
-- WARNING: if any user already owns an instance (user_weapons), removing the
-- roster row breaks that weapon. Preview instances first; if any exist,
-- prefer disabling over deleting:
--   UPDATE public.weapon_roster SET is_available = false WHERE tier = 'Genesis';
-- ---------------------------------------------------------------------------
SELECT COUNT(*) AS owned_genesis_instances
  FROM public.user_weapons uw
  JOIN public.weapon_roster wr ON wr.weapon_roster_id = uw.weapon_roster_id
 WHERE wr.tier = 'Genesis';   -- must be 0 before deleting roster rows

BEGIN;
DELETE FROM public.weapon_roster
 WHERE tier = 'Genesis' AND weapon_roster_id BETWEEN 78 AND 82;
COMMIT;

-- ---------------------------------------------------------------------------
-- [07] Genesis avatar catalog — deactivate rows, restore original CHECKs.
-- Preview ownership first; refunds are a business decision, not automated here.
-- ---------------------------------------------------------------------------
SELECT COUNT(*) AS owned_genesis_avatars
  FROM public.user_avatars ua
  JOIN public.avatar_catalog ac ON ac.avatar_id = ua.avatar_id
 WHERE ac.style = 'genesis';

BEGIN;
-- Unequip + remove ownership + rows (CASCADE via FK covers user_avatars /
-- equipped_avatars references when catalog rows are deleted).
DELETE FROM public.avatar_catalog WHERE style = 'genesis';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'avatar_catalog_style_check'
                AND conrelid = 'public.avatar_catalog'::regclass) THEN
    ALTER TABLE public.avatar_catalog DROP CONSTRAINT avatar_catalog_style_check;
  END IF;
  ALTER TABLE public.avatar_catalog
    ADD CONSTRAINT avatar_catalog_style_check CHECK (
      style IN ('cyber', 'anime', 'webtoon', 'founder', 'tester')
    );

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'avatar_catalog_style_token_cost'
                AND conrelid = 'public.avatar_catalog'::regclass) THEN
    ALTER TABLE public.avatar_catalog DROP CONSTRAINT avatar_catalog_style_token_cost;
  END IF;
  ALTER TABLE public.avatar_catalog
    ADD CONSTRAINT avatar_catalog_style_token_cost CHECK (
      (style = 'cyber'   AND token_cost = 9)
      OR (style = 'anime'   AND token_cost = 12)
      OR (style = 'webtoon' AND token_cost = 15)
      OR (style IN ('founder', 'tester') AND token_cost = 0)
    );
END $$;
COMMIT;

-- ---------------------------------------------------------------------------
-- [06] Celestial reward row.
-- ---------------------------------------------------------------------------
BEGIN;
DELETE FROM public.ranked_reward WHERE bracket = 'Celestial';
COMMIT;

-- ---------------------------------------------------------------------------
-- [05] Restore the 5-name bracket CHECK (run AFTER [06] — a surviving
-- Celestial row would violate the restored constraint).
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'ranked_reward_bracket_check'
                AND conrelid = 'public.ranked_reward'::regclass) THEN
    ALTER TABLE public.ranked_reward DROP CONSTRAINT ranked_reward_bracket_check;
  END IF;
  ALTER TABLE public.ranked_reward
    ADD CONSTRAINT ranked_reward_bracket_check CHECK (
      bracket::text = ANY (ARRAY[
        'Mortal'::character varying, 'Champion'::character varying,
        'Demigod'::character varying, 'Ascendant'::character varying,
        'Divine'::character varying]::text[])
    );
END $$;
COMMIT;

-- ---------------------------------------------------------------------------
-- [03] users_bag columns.
-- *** WARNING: DROP COLUMN permanently destroys purchased Class Change items
-- and Diamond/Genesis Chest quantities. Preview + snapshot first. ***
-- ---------------------------------------------------------------------------
SELECT SUM(change_class)  AS total_change_class,
       SUM(diamond_chest) AS total_diamond_chests,
       SUM(genesis_chest) AS total_genesis_chests
  FROM public.users_bag;

-- Snapshot (recommended):
-- CREATE TABLE users_bag_genesis_backup AS
--   SELECT discord_id, change_class, diamond_chest, genesis_chest
--     FROM public.users_bag
--    WHERE change_class > 0 OR diamond_chest > 0 OR genesis_chest > 0;

BEGIN;
ALTER TABLE public.users_bag
  DROP COLUMN IF EXISTS change_class,
  DROP COLUMN IF EXISTS diamond_chest,
  DROP COLUMN IF EXISTS genesis_chest;
COMMIT;

-- ---------------------------------------------------------------------------
-- [02] CRD Shop purchase tracking.
-- Dropping erases purchase-limit history: users regain full allowances.
-- ---------------------------------------------------------------------------
-- Snapshot (recommended):
-- CREATE TABLE crd_shop_purchases_backup AS SELECT * FROM public.crd_shop_purchases;

BEGIN;
DROP TABLE IF EXISTS public.crd_shop_purchases;
COMMIT;

-- ---------------------------------------------------------------------------
-- [01] Level reward tracking.
-- *** WARNING: dropping these erases the exactly-once history. If the tables
-- are later recreated and the compensation script is rerun, every user will
-- be paid AGAIN. Snapshot first, always. ***
-- ---------------------------------------------------------------------------
-- Snapshot (strongly recommended):
-- CREATE TABLE combat_level_rewards_backup   AS SELECT * FROM public.combat_level_rewards;
-- CREATE TABLE believer_level_rewards_backup AS SELECT * FROM public.believer_level_rewards;

BEGIN;
DROP TABLE IF EXISTS public.combat_level_rewards;
DROP TABLE IF EXISTS public.believer_level_rewards;
COMMIT;

-- ---------------------------------------------------------------------------
-- Reversing GRANTED REWARDS (optional, surgical):
-- Every grant wrote game_logs rows (action 'Level Reward') and tracking rows
-- with source 'levelup' | 'compensation'. To reverse only compensation:
--   1) Preview:  SELECT discord_id, COUNT(*) FROM public.combat_level_rewards
--                 WHERE source = 'compensation' GROUP BY discord_id;
--   2) Deduct per user using the totals reconstructable from game_logs, then
--   3) DELETE FROM public.combat_level_rewards WHERE source = 'compensation';
--      (same for believer_level_rewards)
-- Do NOT drop the tables for this case.
-- ---------------------------------------------------------------------------
