-- ============================================================================
-- 20260730_02_progression_v2_rollback.sql — reverse of 20260730_01
--
-- Restores combat_level / combat_exp from progression_backup_pre_v2, drops
-- lifetime_exp, and returns both level CHECKs to their pre-v2 bounds.
--
-- WHAT THE RESTORE ACTUALLY DOES, so a future reader is not misled:
-- the conversion script writes ONLY lifetime_exp, so restoring combat_level and
-- combat_exp is very nearly a no-op. Its one substantive effect is undoing the
-- null/negative combat_exp normalisation — the sole case where the conversion
-- altered a pre-existing value. The snapshot's larger value is as an audit trail
-- of the cutover state. It is kept because it is cheap, not because the restore
-- is load-bearing.
--
-- ORDER MATTERS. The CHECK returns to 1..50 only after confirming no player has
-- passed the old cap; otherwise the ALTER fails. If players have already gone past
-- 50 under v2 this rollback CANNOT run as written — see the guard below. That is
-- deliberate: silently demoting real progress is worse than a failed migration.
--
-- Apply by hand with psql. Idempotent.
-- ============================================================================

BEGIN;

-- ── Guard: refuse to run if any player has progressed past the old cap ───────
-- Raises before touching anything. If this fires, decide explicitly what should
-- happen to those players before rolling back.
DO $$
DECLARE
  over_cap integer;
BEGIN
  SELECT count(*) INTO over_cap FROM public.user_character WHERE combat_level > 50;
  IF over_cap > 0 THEN
    RAISE EXCEPTION
      'Rollback aborted: % player(s) are above level 50. Rolling back would '
      'violate the restored CHECK and demote real progress. Resolve those rows '
      'deliberately first.', over_cap;
  END IF;
END $$;

-- ── restore the snapshot ────────────────────────────────────────────────────
UPDATE public.user_character uc
   SET combat_level = b.combat_level,
       combat_exp   = b.combat_exp
  FROM public.progression_backup_pre_v2 b
 WHERE uc.discord_id = b.discord_id
   AND (uc.combat_level IS DISTINCT FROM b.combat_level
     OR uc.combat_exp   IS DISTINCT FROM b.combat_exp);

-- ── restore CHECK bounds ────────────────────────────────────────────────────
ALTER TABLE public.user_character
  DROP CONSTRAINT IF EXISTS user_character_combat_level_check;
ALTER TABLE public.user_character
  ADD  CONSTRAINT user_character_combat_level_check
       CHECK (combat_level >= 1 AND combat_level <= 50);

ALTER TABLE public.combat_level_rewards
  DROP CONSTRAINT IF EXISTS combat_level_rewards_level_check;
ALTER TABLE public.combat_level_rewards
  ADD  CONSTRAINT combat_level_rewards_level_check
       CHECK (level BETWEEN 2 AND 50);

-- ── drop the column ─────────────────────────────────────────────────────────
-- Last, so a failure above leaves the source of truth intact.
ALTER TABLE public.user_character DROP COLUMN IF EXISTS lifetime_exp;

COMMIT;

-- progression_backup_pre_v2 is intentionally NOT dropped: it is the only record of
-- the cutover state. Drop it manually once the rollback is confirmed good.
