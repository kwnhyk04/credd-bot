-- ============================================================================
-- 20260730_01_progression_v2.sql — Progression v2 DDL
--
-- Adds user_character.lifetime_exp (the new source of truth for levels), the
-- pre-migration snapshot table, and raises the level-cap CHECKs 50 -> 100.
--
-- DDL ONLY. This file does NOT convert any data. Run the conversion separately:
--     node scripts/progression-v2-migrate.js --dry-run     (report, no writes)
--     node scripts/progression-v2-migrate.js --execute     (convert)
-- The conversion lives in JS because it needs per-user edge-case reporting and an
-- abort assertion that SQL cannot express readably.
--
-- Apply by hand with psql. Per todo.md, migrations are never run from application
-- startup. Idempotent — safe to re-run.
--
-- Reverse: 20260730_02_progression_v2_rollback.sql
-- ============================================================================

BEGIN;

-- ── lifetime_exp ────────────────────────────────────────────────────────────
-- Total EXP ever earned. combat_level and combat_exp become a derived cache over
-- this column, so future rebalances are a table swap in src/config/combatExp.js
-- rather than another data migration.
--
-- BIGINT is required, not defensive: total EXP to level 100 is 3,630,601,650,
-- which overflows int32. src/db/pool.js registers a pg type parser mapping int8
-- to a JS number so arithmetic on this column is not string concatenation —
-- see the comment there before removing it.
--
-- DEFAULT 0 is what makes the conversion script's idempotency guard work: an
-- unconverted row (including a brand-new level 1 player) reads 0.
ALTER TABLE public.user_character
  ADD COLUMN IF NOT EXISTS lifetime_exp BIGINT NOT NULL DEFAULT 0;

-- ── pre-migration snapshot ──────────────────────────────────────────────────
-- Populated by the conversion script before it mutates anything.
--
-- Worth being precise about what this protects, because it is easy to mistake for
-- more than it is: the conversion writes ONLY lifetime_exp, so restoring
-- combat_level and combat_exp is very nearly a no-op. Its one real job is the
-- null/negative combat_exp normalisation, which is the sole case where the
-- conversion changes a pre-existing value. Beyond that it is an audit trail — a
-- record of exactly what every player looked like at the cutover. Cheap enough to
-- keep for both reasons.
CREATE TABLE IF NOT EXISTS public.progression_backup_pre_v2 (
    discord_id   character varying(20) NOT NULL,
    combat_level smallint              NOT NULL,
    combat_exp   bigint                NOT NULL,
    snapshot_at  timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT progression_backup_pre_v2_pkey PRIMARY KEY (discord_id)
);

-- ── level cap 50 -> 100 ─────────────────────────────────────────────────────
ALTER TABLE public.user_character
  DROP CONSTRAINT IF EXISTS user_character_combat_level_check;
ALTER TABLE public.user_character
  ADD  CONSTRAINT user_character_combat_level_check
       CHECK (combat_level >= 1 AND combat_level <= 100);

-- Pre-provisioning ONLY. src/config/levelRewards.js keeps MAX_COMBAT_REWARD_LEVEL
-- at 50 until the deferred 51-100 reward brackets land, so nothing inserts a row
-- above 50 today. Raised here so that change is pure config with no migration.
ALTER TABLE public.combat_level_rewards
  DROP CONSTRAINT IF EXISTS combat_level_rewards_level_check;
ALTER TABLE public.combat_level_rewards
  ADD  CONSTRAINT combat_level_rewards_level_check
       CHECK (level BETWEEN 2 AND 100);

-- believer_level_rewards_level_check is deliberately LEFT AT 2..50. Believer
-- progression is a separate, uncapped system whose reward brackets still stop at
-- 50; raising it would only hide the per-kind cap bug it currently backstops.

COMMIT;

-- ── Validation ──────────────────────────────────────────────────────────────
-- Expect lifetime_exp present, both CHECKs at 100, believer still at 50:
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'user_character' AND column_name = 'lifetime_exp';
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname IN ('user_character_combat_level_check',
--                      'combat_level_rewards_level_check',
--                      'believer_level_rewards_level_check');
