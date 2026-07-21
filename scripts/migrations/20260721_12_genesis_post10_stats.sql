-- ============================================================================
-- 20260721_12_genesis_post10_stats.sql
-- Purpose: backfill Genesis weapons already above +10 to the clarified curve.
--          Each +11..+20 level adds 10% of that weapon's +10 ATK. The step is
--          based on +10 stats, not +0/base stats, and does not compound.
-- Affected table: public.user_weapons (curr_atk only).
-- Safe to rerun: YES (deterministic recalculation from base_atk/enhancement).
-- Prerequisites: migrations 08 and 10.
-- Run in the same maintenance window as the matching application deployment.
-- ============================================================================

-- Preview current and expected values for every affected Genesis weapon.
SELECT uw.weapon_id,
       wr.name,
       uw.enhancement - 1 AS display_level,
       uw.base_atk,
       uw.curr_atk,
       (
         floor(uw.base_atk::numeric * 2.0)
         + floor(floor(uw.base_atk::numeric * 2.0) * 0.10)
           * (uw.enhancement - 11)
       )::integer AS expected_curr_atk
  FROM public.user_weapons AS uw
  JOIN public.weapon_roster AS wr
    ON wr.weapon_roster_id = uw.weapon_roster_id
 WHERE wr.tier = 'Genesis'
   AND uw.enhancement BETWEEN 12 AND 21
 ORDER BY uw.enhancement, uw.weapon_id;

BEGIN;

WITH expected AS (
  SELECT uw.weapon_id,
         (
           floor(uw.base_atk::numeric * 2.0)
           + floor(floor(uw.base_atk::numeric * 2.0) * 0.10)
             * (uw.enhancement - 11)
         )::integer AS curr_atk
    FROM public.user_weapons AS uw
    JOIN public.weapon_roster AS wr
      ON wr.weapon_roster_id = uw.weapon_roster_id
   WHERE wr.tier = 'Genesis'
     AND uw.enhancement BETWEEN 12 AND 21
)
UPDATE public.user_weapons AS uw
   SET curr_atk = expected.curr_atk
  FROM expected
 WHERE uw.weapon_id = expected.weapon_id
   AND uw.curr_atk IS DISTINCT FROM expected.curr_atk;

COMMIT;

-- Validation: expect zero rows. For base ATK 1,600, +11 is 3,520 and +20 is
-- 6,400; every intermediate level adds another 320 ATK.
SELECT uw.weapon_id,
       wr.name,
       uw.enhancement - 1 AS display_level,
       uw.curr_atk
  FROM public.user_weapons AS uw
  JOIN public.weapon_roster AS wr
    ON wr.weapon_roster_id = uw.weapon_roster_id
 WHERE wr.tier = 'Genesis'
   AND uw.enhancement BETWEEN 12 AND 21
   AND uw.curr_atk IS DISTINCT FROM (
     floor(uw.base_atk::numeric * 2.0)
     + floor(floor(uw.base_atk::numeric * 2.0) * 0.10)
       * (uw.enhancement - 11)
   )::integer;

-- Rollback: use section [12] in 20260720_09_rollback.sql together with the
-- prior application version. It restores the old flat +10 ATK for +11..+20.
