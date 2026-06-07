-- =====================================================================
-- CREDD BOT — DATABASE SCHEMA v4 (CREATE TABLES)
-- The Last Believer RPG Discord Bot — PostgreSQL
-- =====================================================================
-- Incorporates all approved Decision Log v1 resolutions:
--   DB-1  user_deities surrogate PK (user_deity_id); active_deity_id FK fixed
--   DB-4  users.last_boss_attack_date (global boss lock)
--   DB-5  boss_state.spawn_id + boss_attack_log.boss_spawn_id (per-spawn scope)
--   DB-6  users.last_daily_claim_date
--   DB-7  user_character.reputation_exp_today / reset_date (5k/day cap)
--   DB-9  boss_state.scaled_atk / scaled_def (post-scaling snapshot)
--   DB-12 game_logs.item_type
--   DB-13 user_guild_activity table (server avg level + admin stats)
--   DB-15 log tables carry no FK (preserved if player deleted)
--   BS-1  active_battles.player_attack_count / enemy_attack_count  [SUPERSEDED -> removed; see v4-PATCH TIMING]
--   BS-8  mob_roster.special_flags (first_strike, multi_attack, etc.)
--   CON-2 deity enhancement uniform (no identity column)
--   CON-3 users_bag starter currencies DEFAULT 0 (granted at char creation)
--   GACHA-2 essence model: user_deities.duplicate_count REMOVED;
--           users_bag.{epic,mythic,legendary,supreme}_essence added
--   KEY-1/4 "none" sentinel allowed for passive_key / skill_key
--   KEY-6 deity_roster.name is UNIQUE
--   + mob_roster gains lore + image_filename  [SUPERSEDED -> removed; see v4-PATCH MOB-ART]
--
-- v4-PATCH (this revision):
--   TIMING  one round-based clock only; per-attack counters REMOVED from active_battles (§35.1)
--   MOB-ART mob_roster lore + image_filename REMOVED (mobs are grind fodder, no art/lore)
--   RETIRE  weapon_roster.is_available + deity_roster.is_available (soft-delete, never DROP owned rows)
--   FK-NULL user_character.equipped_weapon_id / active_deity_id now ON DELETE SET NULL
--   LOCK    user_weapons.is_locked (lock/unlock; locked = excluded from `crd sell`)
--   SELL    `crd sell` deletes unlocked + unequipped rows; logged as game_logs action 'Sell Weapon'
--   BOSS    top-damage reward removed -> participation-only; top-damage index dropped
--
-- Run order is top-to-bottom (dependency-safe).
-- Display rule reminder: enhancement is stored 1..11, shown as +0..+10.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

-- ---------------------------------------------------------------------
-- 1. users  (lean core account; ban-checked on every command)
-- ---------------------------------------------------------------------
CREATE TABLE users (
    discord_id              VARCHAR(20)  PRIMARY KEY,
    username                VARCHAR(100) NOT NULL,
    monthly_streak          SMALLINT     NOT NULL DEFAULT 0,   -- 0..30 (rolling 30-day cycle)
    overall_streak          INTEGER      NOT NULL DEFAULT 0,   -- lifetime, never resets
    last_daily_claim_date   DATE,                              -- DB-6: missed-day / dup-claim detection (PHT)
    last_bestow_received    DATE,                              -- bestow daily-cap anchor
    bestow_received_today   BIGINT       NOT NULL DEFAULT 0,
    last_boss_attack_date   DATE,                              -- DB-4: global cross-server boss lock (PHT)
    is_banned               BOOLEAN      NOT NULL DEFAULT FALSE,
    registered_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_is_banned ON users (is_banned);

-- ---------------------------------------------------------------------
-- 2. weapon_roster  (static reference data; shared across players)
-- ---------------------------------------------------------------------
CREATE TABLE weapon_roster (
    weapon_roster_id    SERIAL       PRIMARY KEY,
    name                VARCHAR(100) NOT NULL,
    type                VARCHAR(10)  NOT NULL CHECK (type IN ('Sword','Staff','Gloves','Shield','Bow')),
    tier                VARCHAR(10)  NOT NULL CHECK (tier IN ('Common','Rare','Mythic','Legendary','Supreme')),
    mythology           VARCHAR(20)  NOT NULL,
    passive_key         VARCHAR(50)  NOT NULL,   -- "none" allowed; must match PASSIVE_REGISTRY
    passive_name        VARCHAR(100) NOT NULL,
    passive_description TEXT         NOT NULL,
    lore                TEXT,
    image_filename      VARCHAR(100),            -- filename only, e.g. 'freyrs_arrow.png'
    is_available        BOOLEAN      NOT NULL DEFAULT TRUE   -- retire a weapon = set FALSE (soft-delete; never DELETE a row players own)
);
CREATE INDEX idx_weapon_roster_tier      ON weapon_roster (tier);
CREATE INDEX idx_weapon_roster_mythology ON weapon_roster (mythology);

-- ---------------------------------------------------------------------
-- 3. deity_roster  (static reference data; shared across players)
-- ---------------------------------------------------------------------
CREATE TABLE deity_roster (
    deity_id             SERIAL       PRIMARY KEY,
    name                 VARCHAR(100) NOT NULL UNIQUE,  -- KEY-6: unique display name
    mythology            VARCHAR(20)  NOT NULL,
    tier                 VARCHAR(10)  NOT NULL CHECK (tier IN ('Epic','Mythic','Legendary','Supreme')),
    base_hp              INTEGER      NOT NULL,
    base_atk             INTEGER      NOT NULL,
    base_def             INTEGER      NOT NULL,
    blessing_key         VARCHAR(50)  NOT NULL,  -- must match PASSIVE_REGISTRY
    blessing_name        VARCHAR(100) NOT NULL,
    blessing_description TEXT         NOT NULL,
    lore                 TEXT,
    image_filename       VARCHAR(100),
    is_available         BOOLEAN      NOT NULL DEFAULT TRUE  -- retire a deity = set FALSE (soft-delete; hidden from gacha pool, never DELETE a row players own)
);
CREATE INDEX idx_deity_roster_tier      ON deity_roster (tier);
CREATE INDEX idx_deity_roster_mythology ON deity_roster (mythology);

-- ---------------------------------------------------------------------
-- 4. mob_roster  (regular / elite / boss reference data)
-- ---------------------------------------------------------------------
CREATE TABLE mob_roster (
    mob_id            SERIAL       PRIMARY KEY,
    name              VARCHAR(100) NOT NULL,
    mythology         VARCHAR(20)  NOT NULL,
    mob_type          VARCHAR(10)  NOT NULL CHECK (mob_type IN ('regular','elite','boss')),
    base_hp           INTEGER      NOT NULL,
    base_atk          INTEGER      NOT NULL,
    base_def          INTEGER      NOT NULL,
    base_crit         DECIMAL(4,1) NOT NULL,
    hp_per_level      INTEGER      NOT NULL DEFAULT 0,   -- regular 20 / elite 38 / boss = authored
    atk_per_level     INTEGER      NOT NULL DEFAULT 0,   -- regular 8  / elite 10 / boss = authored
    def_per_level     INTEGER      NOT NULL DEFAULT 0,   -- regular 5  / elite 8  / boss = authored
    skill_key         VARCHAR(50)  NOT NULL,             -- "none" allowed
    skill_name        VARCHAR(100) NOT NULL,
    skill_description TEXT         NOT NULL,
    immunity_tags     JSONB        NOT NULL DEFAULT '[]'::jsonb,   -- e.g. ["stun","bleed"] or ["all_debuffs"]
    special_flags     JSONB        NOT NULL DEFAULT '{}'::jsonb    -- BS-8 e.g. {"first_strike":true} / {"multi_attack":2,"multi_attack_pct":0.60}
    -- NOTE: mobs intentionally have NO lore / image_filename (grind fodder; battle embeds work without art)
);
CREATE INDEX idx_mob_roster_type      ON mob_roster (mob_type);
CREATE INDEX idx_mob_roster_mythology ON mob_roster (mythology);

-- ---------------------------------------------------------------------
-- 5. users_bag  (currencies, chests, relics, essence)
-- ---------------------------------------------------------------------
CREATE TABLE users_bag (
    discord_id          VARCHAR(20) PRIMARY KEY REFERENCES users (discord_id),
    credux              BIGINT  NOT NULL DEFAULT 0,
    belief_shards       INTEGER NOT NULL DEFAULT 0,   -- CON-3: granted (1000) at character creation
    sacred_relics       INTEGER NOT NULL DEFAULT 0,
    supreme_relics      INTEGER NOT NULL DEFAULT 0,
    silver_chest        INTEGER NOT NULL DEFAULT 0,   -- CON-3: granted (10) at character creation
    gold_chest          INTEGER NOT NULL DEFAULT 0,
    boss_treasure_chest INTEGER NOT NULL DEFAULT 0,
    boss_golden_chest   INTEGER NOT NULL DEFAULT 0,
    supreme_chest       INTEGER NOT NULL DEFAULT 0,
    epic_essence        INTEGER NOT NULL DEFAULT 0,   -- GACHA-2: duplicate Epic deity pulls
    mythic_essence      INTEGER NOT NULL DEFAULT 0,   -- duplicate Mythic (Awakened)
    legendary_essence   INTEGER NOT NULL DEFAULT 0,   -- duplicate Legendary (Undying)
    supreme_essence     INTEGER NOT NULL DEFAULT 0    -- duplicate Supreme (Primordial)
);

-- ---------------------------------------------------------------------
-- 6. user_weapons  (one row per owned weapon; never shared)
-- ---------------------------------------------------------------------
CREATE TABLE user_weapons (
    discord_id         VARCHAR(20)  NOT NULL REFERENCES users (discord_id),
    weapon_id          VARCHAR(8)   PRIMARY KEY,                 -- app-generated 8-char unique id
    weapon_roster_id   INTEGER      NOT NULL REFERENCES weapon_roster (weapon_roster_id),
    curr_atk           INTEGER      NOT NULL,                    -- floor(base * boost_table[enhancement])
    curr_hp            INTEGER      NOT NULL,
    curr_def           INTEGER      NOT NULL,
    enhancement        SMALLINT     NOT NULL DEFAULT 1 CHECK (enhancement BETWEEN 1 AND 11),
    base_atk           INTEGER      NOT NULL,                    -- rolled on drop, static
    base_hp            INTEGER      NOT NULL,
    base_def           INTEGER      NOT NULL,
    crit               DECIMAL(4,1) NOT NULL,                    -- rolled on drop (0 for Supreme)
    bonus_dmg_pct      DECIMAL(5,2),                             -- Legendary/Supreme rider (nullable)
    bonus_crit_dmg_pct DECIMAL(5,2),
    is_locked          BOOLEAN      NOT NULL DEFAULT FALSE,   -- `crd lock`/`crd unlock`; locked = excluded from `crd sell`
    obtained_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_user_weapons_owner       ON user_weapons (discord_id);
CREATE INDEX idx_user_weapons_owner_roster ON user_weapons (discord_id, weapon_roster_id);

-- ---------------------------------------------------------------------
-- 7. user_deities  (one row per owned deity; dupes -> essence, no count)
-- ---------------------------------------------------------------------
CREATE TABLE user_deities (
    user_deity_id  SERIAL      PRIMARY KEY,                      -- DB-1 surrogate key
    discord_id     VARCHAR(20) NOT NULL REFERENCES users (discord_id),
    deity_id       INTEGER     NOT NULL REFERENCES deity_roster (deity_id),
    curr_atk       INTEGER     NOT NULL,                         -- floor(base * (1 + (enhancement-1)*0.10))
    curr_hp        INTEGER     NOT NULL,
    curr_def       INTEGER     NOT NULL,
    enhancement    SMALLINT    NOT NULL DEFAULT 1 CHECK (enhancement BETWEEN 1 AND 11),
    obtained_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_pull_date DATE        NOT NULL,
    UNIQUE (discord_id, deity_id)                                -- one owned row per deity
);
CREATE INDEX idx_user_deities_owner ON user_deities (discord_id);

-- ---------------------------------------------------------------------
-- 8. user_character  (RPG character; created on `crd create character`)
-- ---------------------------------------------------------------------
CREATE TABLE user_character (
    discord_id                VARCHAR(20) PRIMARY KEY REFERENCES users (discord_id),
    class                     VARCHAR(20) NOT NULL CHECK (class IN ('Swordsman','Fighter','Mage','Knight','Archer')),
    combat_level              SMALLINT    NOT NULL DEFAULT 1 CHECK (combat_level BETWEEN 1 AND 50),
    combat_exp                BIGINT      NOT NULL DEFAULT 0,
    equipped_weapon_id        VARCHAR(8)  REFERENCES user_weapons (weapon_id) ON DELETE SET NULL,   -- starter on creation; SET NULL if the weapon row is sold/deleted
    active_deity_id           INTEGER     REFERENCES user_deities (user_deity_id) ON DELETE SET NULL,-- DB-1; set via `crd deity equip`; SET NULL if that deity row is removed
    raids_won                 INTEGER     NOT NULL DEFAULT 0,
    raids_lost                INTEGER     NOT NULL DEFAULT 0,
    pvp_wins                  INTEGER     NOT NULL DEFAULT 0,
    pvp_losses                INTEGER     NOT NULL DEFAULT 0,
    believer_level            INTEGER     NOT NULL DEFAULT 1,    -- reputation level, unlimited
    believer_exp              BIGINT      NOT NULL DEFAULT 0,    -- 3000 flat per level
    reputation_exp_today      INTEGER     NOT NULL DEFAULT 0,    -- DB-7: 5000/day cap
    reputation_exp_reset_date DATE,                              -- DB-7: PHT reset anchor
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_user_character_combat_level ON user_character (combat_level);

-- ---------------------------------------------------------------------
-- 9. pity_counters  (gacha pity; backend only)
-- ---------------------------------------------------------------------
CREATE TABLE pity_counters (
    discord_id VARCHAR(20) PRIMARY KEY REFERENCES users (discord_id),
    pity_count SMALLINT NOT NULL DEFAULT 0   -- reset to 0 on any Legendary or Supreme pull; forced Legendary at 500
);

-- ---------------------------------------------------------------------
-- 10. active_battles  (live raid/boss state; in-memory duels are NOT stored)
-- ---------------------------------------------------------------------
CREATE TABLE active_battles (
    battle_id           SERIAL      PRIMARY KEY,
    discord_id          VARCHAR(20) NOT NULL UNIQUE REFERENCES users (discord_id),
    channel_id          VARCHAR(20) NOT NULL,
    message_id          VARCHAR(20) NOT NULL,
    battle_type         VARCHAR(10) NOT NULL CHECK (battle_type IN ('raid','boss')),  -- 'duel' removed (in-memory)
    mob_id              INTEGER     NOT NULL REFERENCES mob_roster (mob_id),
    enemy_level         SMALLINT    NOT NULL,
    player_hp           INTEGER     NOT NULL,
    player_max_hp       INTEGER     NOT NULL,
    enemy_hp            INTEGER     NOT NULL,
    enemy_max_hp        INTEGER     NOT NULL,
    current_turn        SMALLINT    NOT NULL DEFAULT 1,   -- ROUND counter = the only periodic clock (§35.1)
    player_goes_first   BOOLEAN     NOT NULL,
    active_debuffs      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    battle_log          JSONB       NOT NULL DEFAULT '[]'::jsonb,
    overcharge_pct      SMALLINT    NOT NULL DEFAULT 0,
    bleed_stacks        JSONB       NOT NULL DEFAULT '[]'::jsonb,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_active_battles_channel ON active_battles (channel_id);

-- ---------------------------------------------------------------------
-- 11. boss_state  (one active boss per server; updated in place)
-- ---------------------------------------------------------------------
CREATE TABLE boss_state (
    guild_id    VARCHAR(20) PRIMARY KEY,
    spawn_id    UUID        NOT NULL DEFAULT gen_random_uuid(),  -- DB-5: new per spawn
    mob_id      INTEGER     NOT NULL REFERENCES mob_roster (mob_id),
    boss_level  SMALLINT    NOT NULL,
    max_hp      BIGINT      NOT NULL,
    current_hp  BIGINT      NOT NULL,                            -- shared pool
    scaled_atk  INTEGER     NOT NULL,                            -- DB-9: post-scaling snapshot
    scaled_def  INTEGER     NOT NULL,                            -- DB-9
    spawn_at    TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,                            -- spawn_at + 1 hour
    status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','dead','escaped'))
    -- boss CRIT is read live from mob_roster.base_crit (DB-8)
);

-- ---------------------------------------------------------------------
-- 12. boss_attack_log  (per-spawn damage; NO FK -> history preserved)
-- ---------------------------------------------------------------------
CREATE TABLE boss_attack_log (
    id               SERIAL      PRIMARY KEY,
    boss_spawn_id    UUID        NOT NULL,                       -- DB-5: scopes a single spawn
    guild_id         VARCHAR(20) NOT NULL,
    discord_id       VARCHAR(20) NOT NULL REFERENCES users (discord_id),
    mob_id           INTEGER     NOT NULL,                       -- boss snapshot
    total_damage     BIGINT      NOT NULL DEFAULT 0,
    attacked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_daily_reset DATE        NOT NULL,
    UNIQUE (boss_spawn_id, discord_id)                           -- one attacker row per spawn
);
-- Participation index (rewards are participation-only; top-damage reward removed).
CREATE INDEX idx_boss_attack_spawn ON boss_attack_log (boss_spawn_id);

-- ---------------------------------------------------------------------
-- 13. daily_quests  (3 active quests per player per day)
-- ---------------------------------------------------------------------
CREATE TABLE daily_quests (
    id                   SERIAL      PRIMARY KEY,
    discord_id           VARCHAR(20) NOT NULL REFERENCES users (discord_id),
    quest_type           VARCHAR(30) NOT NULL,   -- raid_wins/elite_defeats/credux_spent/weapon_enhancements/duel_wins/duel_challenges
    target_count         SMALLINT    NOT NULL,
    current_count        SMALLINT    NOT NULL DEFAULT 0,
    reward_credux        INTEGER     NOT NULL,
    reward_belief_shards SMALLINT    NOT NULL,
    completed            BOOLEAN     NOT NULL DEFAULT FALSE,
    quest_date           DATE        NOT NULL,
    UNIQUE (discord_id, quest_type, quest_date)
);
CREATE INDEX idx_daily_quests_player_date ON daily_quests (discord_id, quest_date);

-- ---------------------------------------------------------------------
-- 14. server_config  (per-server settings)
-- ---------------------------------------------------------------------
CREATE TABLE server_config (
    guild_id                     VARCHAR(20) PRIMARY KEY,
    prefix                       VARCHAR(5)  NOT NULL DEFAULT 'crd',
    announcement_channel_id      VARCHAR(20),
    boss_announcement_channel_id VARCHAR(20),
    bot_channel_id               VARCHAR(20),
    configured_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 15. user_guild_activity  (DB-13: server-avg level + admin active-player stats)
-- ---------------------------------------------------------------------
CREATE TABLE user_guild_activity (
    discord_id  VARCHAR(20) NOT NULL REFERENCES users (discord_id),
    guild_id    VARCHAR(20) NOT NULL,
    last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (discord_id, guild_id)
);
CREATE INDEX idx_user_guild_activity_guild ON user_guild_activity (guild_id, last_active);

-- ---------------------------------------------------------------------
-- 16. raid_logs  (immutable PvE results; no FK)
-- ---------------------------------------------------------------------
CREATE TABLE raid_logs (
    id                    BIGSERIAL   PRIMARY KEY,
    discord_id            VARCHAR(20) NOT NULL,   -- no FK: preserved if player deleted
    battle_type           VARCHAR(10) NOT NULL,
    enemy_name            VARCHAR(100) NOT NULL,
    enemy_tier            VARCHAR(10) NOT NULL CHECK (enemy_tier IN ('regular','elite','boss')),
    result                VARCHAR(5)  NOT NULL CHECK (result IN ('win','loss')),
    exp_earned            INTEGER     NOT NULL DEFAULT 0,
    updated_exp           BIGINT      NOT NULL,
    belief_shards_dropped SMALLINT    NOT NULL DEFAULT 0,
    updated_belief_shards INTEGER     NOT NULL,
    credux_earned         INTEGER     NOT NULL DEFAULT 0,
    updated_credux        BIGINT      NOT NULL,
    chest_dropped         VARCHAR(30),
    timestamp             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_raid_logs_player      ON raid_logs (discord_id);
CREATE INDEX idx_raid_logs_player_time ON raid_logs (discord_id, timestamp DESC);

-- ---------------------------------------------------------------------
-- 17. pvp_logs  (immutable duel results; no FK)
-- ---------------------------------------------------------------------
CREATE TABLE pvp_logs (
    id               BIGSERIAL   PRIMARY KEY,
    challenger_id    VARCHAR(20) NOT NULL,   -- no FK
    opponent_id      VARCHAR(20) NOT NULL,
    winner_id        VARCHAR(20) NOT NULL,
    challenger_damage INTEGER    NOT NULL,
    opponent_damage  INTEGER     NOT NULL,
    timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pvp_logs_challenger ON pvp_logs (challenger_id);
CREATE INDEX idx_pvp_logs_opponent   ON pvp_logs (opponent_id);

-- ---------------------------------------------------------------------
-- 18. game_logs  (immutable economy audit; no FK)
-- ---------------------------------------------------------------------
CREATE TABLE game_logs (
    id                     BIGSERIAL   PRIMARY KEY,
    discord_id             VARCHAR(20) NOT NULL,   -- no FK
    action                 VARCHAR(30) NOT NULL,   -- Bestow/Enhance/Daily/Deity Pull/Deity Enhance/<Chest>/Sacred Relic/Supreme Relic/Sell Weapon
    item_type              VARCHAR(30),            -- DB-12: which chest/relic/essence tier moved
    previous_credux        BIGINT,
    updated_credux         BIGINT,
    previous_belief_shards INTEGER,
    updated_belief_shards  INTEGER,
    previous_chest_count   INTEGER,
    updated_chest_count    INTEGER,
    previous_relic_count   INTEGER,
    updated_relic_count    INTEGER,
    previous_essence_count INTEGER,                -- GACHA-2: essence gained (pull) / spent (deity enhance)
    updated_essence_count  INTEGER,
    timestamp              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_game_logs_player      ON game_logs (discord_id);
CREATE INDEX idx_game_logs_player_time ON game_logs (discord_id, timestamp DESC);

-- ---------------------------------------------------------------------
-- 19. casino_logs  (immutable casino audit; no FK)
-- ---------------------------------------------------------------------
CREATE TABLE casino_logs (
    id             BIGSERIAL   PRIMARY KEY,
    discord_id     VARCHAR(20) NOT NULL,   -- no FK
    game           VARCHAR(20) NOT NULL,   -- coin_toss/dice_roll/baccarat/blackjack/slot_machine/crash
    bet_amount     BIGINT      NOT NULL,
    result         VARCHAR(5)  NOT NULL CHECK (result IN ('win','loss')),
    payout         BIGINT      NOT NULL,
    balance_before BIGINT      NOT NULL,
    balance_after  BIGINT      NOT NULL,
    metadata       JSONB,
    timestamp      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_casino_logs_player      ON casino_logs (discord_id);
CREATE INDEX idx_casino_logs_player_time ON casino_logs (discord_id, timestamp DESC);

-- ---------------------------------------------------------------------
-- 20. dev_logs  (immutable dev-action audit)
-- ---------------------------------------------------------------------
CREATE TABLE dev_logs (
    id                 BIGSERIAL   PRIMARY KEY,
    dev_id             VARCHAR(20) NOT NULL,
    action_type        VARCHAR(30) NOT NULL,   -- give_credux/give_beliefshards/give_chest/give_relic/ban/unban/reset/enhance_weapon/enhance_deity
    target_discord_id  VARCHAR(20) NOT NULL,
    amount_or_detail   VARCHAR(200),
    pre_reset_snapshot JSONB,
    timestamp          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- END SCHEMA v4
-- Next: seed roster tables (weapon_roster, deity_roster, mob_roster).
-- See CREDD_Roster_and_Asset_Conventions.md for key + filename rules
-- and copy-paste INSERT templates.
-- =====================================================================
