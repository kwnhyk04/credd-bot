-- v12: DB-backed active casino sessions for stateful casino games.
-- Additive only. Prevents duplicate active blackjack/crash sessions across bot instances
-- and provides a stale-session refund path after process restarts.

CREATE TABLE IF NOT EXISTS active_casino_sessions (
    session_id          UUID        PRIMARY KEY,
    discord_id          VARCHAR(20) NOT NULL REFERENCES users (discord_id) ON DELETE CASCADE,
    game                VARCHAR(20) NOT NULL CHECK (game IN ('blackjack', 'crash')),
    status              VARCHAR(20) NOT NULL CHECK (status IN ('active', 'resolving', 'settled', 'refunded', 'expired')),
    bet_amount          BIGINT      NOT NULL CHECK (bet_amount > 0),
    balance_before      BIGINT      NOT NULL,
    balance_after_debit BIGINT      NOT NULL,
    payout              BIGINT,
    balance_after       BIGINT,
    channel_id          VARCHAR(20),
    message_id          VARCHAR(20),
    state_json          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    metadata            JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS active_casino_sessions_one_active
ON active_casino_sessions (discord_id, game)
WHERE status IN ('active', 'resolving');

CREATE INDEX IF NOT EXISTS idx_active_casino_sessions_expiry
ON active_casino_sessions (status, expires_at);

