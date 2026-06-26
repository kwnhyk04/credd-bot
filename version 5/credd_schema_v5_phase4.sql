-- ============================================================================
-- CREDD v5 — Phase 4: Ranked PvP + Leaderboards
-- Run AFTER credd_schema_v5_migration.sql (pvp_rating, boss_kills,
-- lifetime_credux_earned) and credd_schema_v5b_runes_seasons.sql (ranked_reward).
-- ============================================================================
BEGIN;

-- §1  Ranked ladder state on user_character
ALTER TABLE user_character
    ADD COLUMN IF NOT EXISTS pvp_peak INTEGER NOT NULL DEFAULT 1000,            -- peak rating (Phase 5 season-end)
    ADD COLUMN IF NOT EXISTS last_weekly_claim_week INTEGER,                    -- PHT ISO week of last weekly claim (dedupe)
    ADD COLUMN IF NOT EXISTS pvp_demotion_shield BOOLEAN NOT NULL DEFAULT TRUE; -- one protected loss at a bracket floor

-- §2  Ranked match history — powers the >=5 games/week weekly-claim gate + rating audit.
CREATE TABLE IF NOT EXISTS ranked_logs (
    id            BIGSERIAL   PRIMARY KEY,
    player_id     VARCHAR(20) NOT NULL REFERENCES users (discord_id),
    opponent_id   VARCHAR(20) NOT NULL,                 -- snapshot opponent (only the player's rating moves)
    result        VARCHAR(4)  NOT NULL CHECK (result IN ('win','loss')),
    rating_before INTEGER     NOT NULL,
    rating_after  INTEGER     NOT NULL,
    timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ranked_logs_player_time ON ranked_logs (player_id, timestamp);

-- §3  Wager duel ledger ("log all" — wager duels carry NO rating, NO casual win/loss).
CREATE TABLE IF NOT EXISTS wager_logs (
    id            BIGSERIAL   PRIMARY KEY,
    challenger_id VARCHAR(20) NOT NULL,
    opponent_id   VARCHAR(20) NOT NULL,
    winner_id     VARCHAR(20) NOT NULL,
    amount        BIGINT      NOT NULL,
    timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wager_logs_challenger ON wager_logs (challenger_id);
CREATE INDEX IF NOT EXISTS idx_wager_logs_opponent   ON wager_logs (opponent_id);

COMMIT;
