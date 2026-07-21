-- ============================================================================
-- 20260721_10_genesis_enhancement_cap.sql
-- Purpose: permit the one-based stored enhancement value required for Genesis
--          weapons at display +20 (stored 21). Application code continues to
--          cap every non-Genesis weapon and all armor at display +10.
-- Affected tables: public.user_weapons (CHECK constraint only; no row updates)
-- Safe to rerun: YES (the named constraint is recreated to the same definition).
-- Run immediately before (or in the same maintenance window as) deployment.
-- The old application still caps every weapon at +10, so widening first is safe.
-- ============================================================================

-- Preview the current constraint and enhancement distribution.
SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'user_weapons_enhancement_check'
   AND conrelid = 'public.user_weapons'::regclass;

SELECT wr.tier, MIN(uw.enhancement) AS min_stored,
       MAX(uw.enhancement) AS max_stored, COUNT(*) AS weapon_count
  FROM public.user_weapons uw
  JOIN public.weapon_roster wr ON wr.weapon_roster_id = uw.weapon_roster_id
 GROUP BY wr.tier
 ORDER BY wr.tier;

BEGIN;

ALTER TABLE public.user_weapons
  DROP CONSTRAINT IF EXISTS user_weapons_enhancement_check;

ALTER TABLE public.user_weapons
  ADD CONSTRAINT user_weapons_enhancement_check
  CHECK (enhancement >= 1 AND enhancement <= 21);

COMMIT;

-- Validate the new ceiling and confirm no non-Genesis row is above stored 11.
SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'user_weapons_enhancement_check'
   AND conrelid = 'public.user_weapons'::regclass;

SELECT uw.weapon_id, wr.tier, uw.enhancement
  FROM public.user_weapons uw
  JOIN public.weapon_roster wr ON wr.weapon_roster_id = uw.weapon_roster_id
 WHERE uw.enhancement > 21
    OR (wr.tier <> 'Genesis' AND uw.enhancement > 11);

-- Rollback: use the guarded [10] section in 20260720_09_rollback.sql.
-- It refuses to restore the old <=11 constraint while any row is above 11.
-- The database CHECK cannot reference weapon_roster; tier-specific enforcement
-- therefore remains in the transactional application path and dev command.
