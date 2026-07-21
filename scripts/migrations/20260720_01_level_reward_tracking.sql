-- ============================================================================
-- 20260720_01_level_reward_tracking.sql
-- Purpose: exactly-once tracking tables for automatic Combat Level and
--          Believer Level rewards (Genesis update, spec sections 1-3).
-- Affected tables: NEW public.combat_level_rewards, NEW public.believer_level_rewards
-- Safe to rerun: YES (pure IF NOT EXISTS; no data changes).
-- Run BEFORE deploying the reward-engine code (schemaGuard checks these tables).
-- ============================================================================

-- Preview: confirm the tables do not exist yet.
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('combat_level_rewards', 'believer_level_rewards');

BEGIN;

-- One row per (user, level) actually rewarded. The composite PK is the
-- exactly-once guard: level-up grants, retries, concurrent transactions,
-- restarts, and compensation reruns all collapse on ON CONFLICT DO NOTHING.
-- Levels start at 2 by design decision (level 1 is the starting level and is
-- never rewarded, neither live nor via compensation).
CREATE TABLE IF NOT EXISTS public.combat_level_rewards (
    discord_id  character varying(20) NOT NULL,
    level       smallint NOT NULL,
    source      character varying(20) NOT NULL DEFAULT 'levelup',
    created_at  timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT combat_level_rewards_pkey PRIMARY KEY (discord_id, level),
    CONSTRAINT combat_level_rewards_level_check CHECK (level BETWEEN 2 AND 50),
    CONSTRAINT combat_level_rewards_source_check CHECK (source IN ('levelup', 'compensation'))
);

CREATE TABLE IF NOT EXISTS public.believer_level_rewards (
    discord_id  character varying(20) NOT NULL,
    level       smallint NOT NULL,
    source      character varying(20) NOT NULL DEFAULT 'levelup',
    created_at  timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT believer_level_rewards_pkey PRIMARY KEY (discord_id, level),
    CONSTRAINT believer_level_rewards_level_check CHECK (level BETWEEN 2 AND 50),
    CONSTRAINT believer_level_rewards_source_check CHECK (source IN ('levelup', 'compensation'))
);

COMMIT;

-- Validation: both tables exist with the composite PKs.
SELECT c.conname, c.conrelid::regclass AS table_name
  FROM pg_constraint c
 WHERE c.conname IN ('combat_level_rewards_pkey', 'believer_level_rewards_pkey');

-- Notes:
-- * The PK doubles as the lookup index for "which levels are already rewarded";
--   no additional index is required.
-- * No FK to users(discord_id) on purpose: reward history must survive user-row
--   maintenance, and the app only ever inserts ids it just read from
--   user_character inside the same transaction.
-- * Rollback: see 20260720_09_rollback.sql (snapshot first!).
