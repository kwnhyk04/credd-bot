-- =====================================================================
-- CREDD v5 — Auto Raid (idle/passive raid system)
-- Companion code: src/commands/rpg/autoRaid.js (reward formula derives from
--   src/config/raidLoot.js). Player-driven claim — no scheduler/cron.
-- Idempotent — safe to re-run.
-- =====================================================================
BEGIN;

-- One active auto-raid run per player. Row present = run in progress / awaiting
-- claim; it is DELETED on claim, so the player can start again immediately.
-- combat_level is snapshotted at Start so the window length + payout are fixed
-- at launch (leveling mid-run does not change the result).
CREATE TABLE IF NOT EXISTS auto_raids (
  discord_id   VARCHAR(20) PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at      TIMESTAMPTZ NOT NULL,
  combat_level SMALLINT    NOT NULL
);

COMMIT;
