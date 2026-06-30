-- Additive DB-backed active duel locks.
-- Duels stay separate from active_battles because active_battles stores raid/boss
-- combat state and explicitly excludes duel battle_type values.

CREATE TABLE IF NOT EXISTS active_duels (
    duel_id       UUID        PRIMARY KEY,
    lock_token    UUID        NOT NULL,
    challenger_id VARCHAR(20) NOT NULL,
    opponent_id   VARCHAR(20) NOT NULL,
    duel_type     VARCHAR(10) NOT NULL CHECK (duel_type IN ('casual','wager')),
    stake         BIGINT,
    status        VARCHAR(12) NOT NULL CHECK (status IN ('pending','running','settling')),
    guild_id      VARCHAR(20),
    channel_id    VARCHAR(20),
    message_id    VARCHAR(20),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at   TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ NOT NULL,
    CHECK (stake IS NULL OR stake >= 0)
);

CREATE TABLE IF NOT EXISTS active_duel_participants (
    discord_id VARCHAR(20) PRIMARY KEY,
    duel_id    UUID        NOT NULL REFERENCES active_duels (duel_id) ON DELETE CASCADE,
    lock_token UUID        NOT NULL,
    role       VARCHAR(12) NOT NULL CHECK (role IN ('challenger','opponent')),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_active_duels_expires_at
ON active_duels (expires_at);

CREATE INDEX IF NOT EXISTS idx_active_duel_participants_duel
ON active_duel_participants (duel_id);
