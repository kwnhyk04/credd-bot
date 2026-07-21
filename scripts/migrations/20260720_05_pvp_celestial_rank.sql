-- ============================================================================
-- 20260720_05_pvp_celestial_rank.sql
-- Purpose: allow the new highest PvP rank "Celestial" (>= 20,000 points,
--          spec section 15) in the ranked_reward bracket CHECK constraint.
--          Rank brackets themselves are code-side (src/config/ranked.js);
--          the only database artifact is this CHECK on ranked_reward.bracket.
-- Affected tables: public.ranked_reward (constraint only; no rows changed)
-- Safe to rerun: YES (drop-if-exists + recreate yields the same end state).
-- Run BEFORE 20260720_06_pvp_celestial_rewards.sql.
-- ============================================================================

-- Preview: current bracket rows and the current constraint definition.
SELECT bracket FROM public.ranked_reward ORDER BY bracket;
SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'ranked_reward_bracket_check'
   AND conrelid = 'public.ranked_reward'::regclass;

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ranked_reward_bracket_check'
       AND conrelid = 'public.ranked_reward'::regclass
  ) THEN
    ALTER TABLE public.ranked_reward
      DROP CONSTRAINT ranked_reward_bracket_check;
  END IF;

  ALTER TABLE public.ranked_reward
    ADD CONSTRAINT ranked_reward_bracket_check CHECK (
      bracket::text = ANY (ARRAY[
        'Mortal'::character varying,
        'Champion'::character varying,
        'Demigod'::character varying,
        'Ascendant'::character varying,
        'Divine'::character varying,
        'Celestial'::character varying
      ]::text[])
    );
END $$;

COMMIT;

-- Validation: constraint now lists six bracket names including Celestial.
SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'ranked_reward_bracket_check'
   AND conrelid = 'public.ranked_reward'::regclass;

-- Notes:
-- * 'Celestial' is 9 characters and fits the bracket varchar(10) column.
-- * Existing rows (Mortal..Divine) all satisfy the new CHECK, so the ADD
--   cannot fail on validation.
-- * Code-side boundary change (Divine capped at 19,999) ships with the
--   Celestial code deploy; this script is required BEFORE inserting the
--   Celestial reward row (script 06).
-- * Rollback: see 20260720_09_rollback.sql (restores the 5-name CHECK after
--   deleting the Celestial row).