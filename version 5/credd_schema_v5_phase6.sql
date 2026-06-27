-- =====================================================================
-- CREDD v5 — Phase 6 schema (PvP economy + weekly quests + retune scaffolding)
-- Companion code: src/config/ranked.js, src/commands/rpg/ranked.js, pvpShop.js,
--   exchangeEssence.js, src/utils/questProgress.js, src/commands/economy/quests.js,
--   src/engine/seasonEngine.js. Idempotent — safe to re-run.
-- =====================================================================
BEGIN;

-- A1. Valor Medals — the PvP currency (earned win/loss, weekly + season payouts;
--     spent only in `crd pvp shop`). lifetime grind currency stays separate.
ALTER TABLE users_bag ADD COLUMN IF NOT EXISTS valor_medals BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ub_valor ON users_bag (valor_medals DESC);

-- A2. Valor in ranked rewards (weekly by current bracket + season by peak bracket).
ALTER TABLE ranked_reward ADD COLUMN IF NOT EXISTS weekly_valor INT NOT NULL DEFAULT 0;
ALTER TABLE ranked_reward ADD COLUMN IF NOT EXISTS season_valor INT NOT NULL DEFAULT 0;
-- Ascending by bracket — tuned so a steady ranked player reaches a Supreme shop
-- item (6,000 / 9,000 Valor) in ~2-3 months (combat drops + weekly + season).
UPDATE ranked_reward SET weekly_valor = 50,  season_valor = 400  WHERE bracket = 'Mortal';
UPDATE ranked_reward SET weekly_valor = 100, season_valor = 800  WHERE bracket = 'Champion';
UPDATE ranked_reward SET weekly_valor = 175, season_valor = 1400 WHERE bracket = 'Demigod';
UPDATE ranked_reward SET weekly_valor = 275, season_valor = 2200 WHERE bracket = 'Ascendant';
UPDATE ranked_reward SET weekly_valor = 400, season_valor = 3200 WHERE bracket = 'Divine';

-- A3. Weekly quests — mirror daily_quests but bucketed by PHT ISO week (year*100+week).
--     Reward is Credux + Valor (no belief shards). 5 lines/week; clearing ALL 5 unlocks
--     the grand bundle (1 Sacred Relic), tracked in weekly_grand.
CREATE TABLE IF NOT EXISTS weekly_quests (
    id            SERIAL      PRIMARY KEY,
    discord_id    VARCHAR(20) NOT NULL REFERENCES users (discord_id),
    quest_type    VARCHAR(30) NOT NULL,
    target_count  INTEGER     NOT NULL,
    current_count INTEGER     NOT NULL DEFAULT 0,
    reward_credux INTEGER     NOT NULL,
    reward_valor  INTEGER     NOT NULL,
    completed     BOOLEAN     NOT NULL DEFAULT FALSE,
    quest_week    INTEGER     NOT NULL,
    UNIQUE (discord_id, quest_type, quest_week)
);
CREATE INDEX IF NOT EXISTS idx_weekly_quests_user_week ON weekly_quests (discord_id, quest_week);

-- A4. Grand-reward claim guard (one bundle per player per week, only when all 5 done).
CREATE TABLE IF NOT EXISTS weekly_grand (
    discord_id VARCHAR(20) NOT NULL REFERENCES users (discord_id),
    quest_week INTEGER     NOT NULL,
    claimed    BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (discord_id, quest_week)
);

-- A5. PvP shop per-season purchase counter (enforces season caps; resets each season_id).
CREATE TABLE IF NOT EXISTS pvp_shop_purchases (
    discord_id VARCHAR(20) NOT NULL REFERENCES users (discord_id),
    season_id  INTEGER     NOT NULL,
    item_key   VARCHAR(30) NOT NULL,
    qty        INTEGER     NOT NULL DEFAULT 0,
    PRIMARY KEY (discord_id, season_id, item_key)
);

COMMIT;
