-- =====================================================================
-- CREDD v8 - Active ranked fight guard
-- Additive runtime lock table for `crd ranked`.
-- Prevents the same player from starting multiple ranked fights across
-- multiple bot processes/instances while allowing stale crash recovery.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS active_ranked_fights (
    discord_id VARCHAR(20)  PRIMARY KEY REFERENCES users (discord_id) ON DELETE CASCADE,
    lock_token VARCHAR(64)  NOT NULL,
    started_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_active_ranked_fights_expires_at
    ON active_ranked_fights (expires_at);

COMMIT;
