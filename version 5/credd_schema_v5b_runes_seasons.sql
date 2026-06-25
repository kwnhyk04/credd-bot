-- =====================================================================
-- CREDD BOT — SCHEMA MIGRATION v5b  (RUNES content + ESSENCE BAGS + SEASONS/TITLES)
-- ADDITIVE to credd_schema_v5_migration.sql — run AFTER it.
-- Phase 2 (runes) + Phase 5 (seasons/titles) data. All VALUES are placeholders to TUNE.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- A. RUNE CONTENT  — replace the single-row reference seed from v5 §3 with the full tiered set.
-- ---------------------------------------------------------------------
-- Clear the v5 reference seed (the 10 Rare placeholder rows) and reseed full tiers.
DELETE FROM rune_roster;
ALTER SEQUENCE rune_roster_rune_id_seq RESTART WITH 1;

-- value = legacy/default magnitude (%, or % points for CRIT). Owned runes roll
-- their actual value into user_runes.rolled_value from code-side ranges:
-- Sharpness:  Rare 1-3, Mythic 4-7, Legendary 8-12, Supreme 15-20
-- Precision:  Rare 1-2, Mythic 3-6, Legendary 7-10, Supreme 12-15
-- Vampiric:   Rare 1-3, Mythic 4-7, Legendary 8-12, Supreme 15-20
-- Piercing:   Rare 2-4, Mythic 5-7, Legendary 8-13, Supreme 15-20
-- Venom:      Rare 5-10, Mythic 11-15, Legendary 16-20, Supreme 25-30
-- Vitality:   Rare 3-7, Mythic 8-12, Legendary 15-20, Supreme 25-30
-- Bulwark:    Rare 1-3, Mythic 4-7, Legendary 8-12, Supreme 15-20
-- Thorns:     Rare 2-4, Mythic 5-7, Legendary 8-13, Supreme 15-20
-- Warding:    Rare 3-5, Mythic 7-9, Legendary 10-13, Supreme 15-20
-- Aegis:      Rare 1-3, Mythic 4-8, Legendary 10-13, Supreme 15-20
INSERT INTO rune_roster (name, lane, effect_key, tier, value, description) VALUES
-- OFFENSE LANE (weapon native / armor opposite) -----------------------
('Sharpness',  'offense', 'sharpness', 'Rare',      3.00,  'ATK +3%'),
('Sharpness',  'offense', 'sharpness', 'Mythic',    5.00,  'ATK +5%'),
('Sharpness',  'offense', 'sharpness', 'Legendary', 10.00, 'ATK +10%'),
('Sharpness',  'offense', 'sharpness', 'Supreme',   20.00, 'ATK +20%'),
('Precision',  'offense', 'precision', 'Rare',      2.00,  'CRIT +2%'),
('Precision',  'offense', 'precision', 'Mythic',    5.00,  'CRIT +5%'),
('Precision',  'offense', 'precision', 'Legendary', 10.00, 'CRIT +10%'),
('Precision',  'offense', 'precision', 'Supreme',   15.00, 'CRIT +15%'),
('Vampiric',   'offense', 'vampiric',  'Rare',      3.00,  'Lifesteal 3% of damage dealt'),
('Vampiric',   'offense', 'vampiric',  'Mythic',    5.00,  'Lifesteal 5% of damage dealt'),
('Vampiric',   'offense', 'vampiric',  'Legendary', 10.00, 'Lifesteal 10% of damage dealt'),
('Vampiric',   'offense', 'vampiric',  'Supreme',   20.00, 'Lifesteal 20% of damage dealt'),
('Piercing',   'offense', 'piercing',  'Rare',      4.00,  'Ignore 4% of enemy DEF'),
('Piercing',   'offense', 'piercing',  'Mythic',    7.00,  'Ignore 7% of enemy DEF'),
('Piercing',   'offense', 'piercing',  'Legendary', 11.00, 'Ignore 11% of enemy DEF'),
('Piercing',   'offense', 'piercing',  'Supreme',   20.00, 'Ignore 20% of enemy DEF'),
('Venom',      'offense', 'venom',     'Rare',      10.00, 'On hit: flat DOT 10% ATK/turn (2 turns)'),
('Venom',      'offense', 'venom',     'Mythic',    15.00, 'On hit: flat DOT 15% ATK/turn (2 turns)'),
('Venom',      'offense', 'venom',     'Legendary', 20.00, 'On hit: flat DOT 20% ATK/turn (2 turns)'),
('Venom',      'offense', 'venom',     'Supreme',   30.00, 'On hit: flat DOT 30% ATK/turn (2 turns)'),
-- DEFENSE LANE (armor native / weapon opposite) -----------------------
('Vitality',   'defense', 'vitality',  'Rare',      5.00,  'HP +5%'),
('Vitality',   'defense', 'vitality',  'Mythic',    10.00, 'HP +10%'),
('Vitality',   'defense', 'vitality',  'Legendary', 20.00, 'HP +20%'),
('Vitality',   'defense', 'vitality',  'Supreme',   30.00, 'HP +30%'),
('Bulwark',    'defense', 'bulwark',   'Rare',      3.00,  'DEF +3%'),
('Bulwark',    'defense', 'bulwark',   'Mythic',    5.00,  'DEF +5%'),
('Bulwark',    'defense', 'bulwark',   'Legendary', 10.00, 'DEF +10%'),
('Bulwark',    'defense', 'bulwark',   'Supreme',   20.00, 'DEF +20%'),
('Thorns',     'defense', 'thorns',    'Rare',      4.00,  'Reflect 4% of damage taken'),
('Thorns',     'defense', 'thorns',    'Mythic',    7.00,  'Reflect 7% of damage taken'),
('Thorns',     'defense', 'thorns',    'Legendary', 11.00, 'Reflect 11% of damage taken'),
('Thorns',     'defense', 'thorns',    'Supreme',   20.00, 'Reflect 20% of damage taken'),
('Warding',    'defense', 'warding',   'Rare',      5.00,  'Incoming DOT reduced by 5%'),
('Warding',    'defense', 'warding',   'Mythic',    8.00,  'Incoming DOT reduced by 8%'),
('Warding',    'defense', 'warding',   'Legendary', 13.00, 'Incoming DOT reduced by 13%'),
('Warding',    'defense', 'warding',   'Supreme',   20.00, 'Incoming DOT reduced by 20%'),
('Aegis',      'defense', 'aegis_rune','Rare',      2.00,  'Incoming damage reduced by 2%'),
('Aegis',      'defense', 'aegis_rune','Mythic',    4.00,  'Incoming damage reduced by 4%'),
('Aegis',      'defense', 'aegis_rune','Legendary', 8.00,  'Incoming damage reduced by 8%'),
('Aegis',      'defense', 'aegis_rune','Supreme',   20.00, 'Incoming damage reduced by 20%');

-- ---------------------------------------------------------------------
-- B. RUNE ECONOMY  — opposite-slot unlock costs + essence-bag definitions (config tables)
-- ---------------------------------------------------------------------
-- Opposite-slot unlock cost (Credux + same-tier essence). Caps: Mythic 1 / Legendary 2 / Supreme 2.
CREATE TABLE socket_unlock_cost (
    tier            VARCHAR(10) NOT NULL CHECK (tier IN ('Mythic','Legendary','Supreme')),
    slot_index      SMALLINT    NOT NULL,   -- 1 = first opposite slot, 2 = second
    essence_tier    VARCHAR(10) NOT NULL,   -- which essence to spend (the gear's own tier)
    essence_cost    INTEGER     NOT NULL,
    credux_cost     BIGINT      NOT NULL,
    PRIMARY KEY (tier, slot_index)
);
INSERT INTO socket_unlock_cost (tier, slot_index, essence_tier, essence_cost, credux_cost) VALUES
('Mythic',    1, 'mythic',    50, 100000),
('Legendary', 1, 'legendary',  5, 250000),
('Legendary', 2, 'legendary', 10, 500000),
('Supreme',   1, 'supreme',    5, 500000),
('Supreme',   2, 'supreme',   10, 1000000);

-- Essence Bag definitions (the primary rune faucet). Open → random rune by the bag's weighted pool.
-- rune_pool = array of {tier, weight} where weights sum to 100 (percent chance of that tier; the
-- specific rune family within the chosen tier is then uniformly random).
CREATE TABLE essence_bag_def (
    bag_key      VARCHAR(20) PRIMARY KEY,           -- lesser / greater / divine
    open_command VARCHAR(10) NOT NULL,              -- eb / geb / deb
    essence_tier VARCHAR(10) NOT NULL,              -- essence spent to craft/open
    essence_cost INTEGER     NOT NULL,
    credux_cost  BIGINT      NOT NULL,
    rune_pool    JSONB       NOT NULL                -- weighted tier table (see above)
);
INSERT INTO essence_bag_def (bag_key, open_command, essence_tier, essence_cost, credux_cost, rune_pool) VALUES
('lesser',  'eb',  'mythic',    10, 50000,  '[{"tier":"Rare","weight":100}]'::jsonb),
('greater', 'geb', 'legendary',  10, 125000,  '[{"tier":"Mythic","weight":85},{"tier":"Legendary","weight":15}]'::jsonb),
('divine',  'deb', 'supreme',    10, 250000, '[{"tier":"Legendary","weight":85},{"tier":"Supreme","weight":15}]'::jsonb);
-- Drop rates (per user spec):
--   Lesser  -> 100% Rare rune
--   Greater -> 85% Mythic / 15% Legendary
--   Divine  -> 85% Legendary / 15% Supreme
-- (Epic essence has no bag of its own — it feeds the exchange shop §D upward into Mythic.)

-- ---------------------------------------------------------------------
-- C. SEASONS & TITLES  (Phase 5 scaffolding)
-- ---------------------------------------------------------------------
CREATE TABLE seasons (
    season_id     SERIAL      PRIMARY KEY,
    name          VARCHAR(50) NOT NULL,             -- e.g. "Embercrowned"
    theme         VARCHAR(50),                      -- e.g. "Greek / fire"
    starts_at     TIMESTAMPTZ NOT NULL,
    ends_at       TIMESTAMPTZ NOT NULL,             -- 2-month window
    featured_deity_id INTEGER REFERENCES deity_roster (deity_id),
    is_active     BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE title_catalog (
    title_id     SERIAL      PRIMARY KEY,
    code         VARCHAR(40) NOT NULL UNIQUE,       -- slug, e.g. "divine_embercrowned"
    display      VARCHAR(60) NOT NULL,              -- "Divine — Embercrowned"
    source       VARCHAR(20) NOT NULL CHECK (source IN ('believer','rank_season','boss_feat','collection','event')),
    is_repeatable BOOLEAN    NOT NULL DEFAULT TRUE  -- season rank titles = FALSE (never re-earnable)
);

CREATE TABLE user_titles (
    discord_id  VARCHAR(20) NOT NULL REFERENCES users (discord_id),
    title_id    INTEGER     NOT NULL REFERENCES title_catalog (title_id),
    earned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (discord_id, title_id)
);
-- equipped title pointer
ALTER TABLE user_character
    ADD COLUMN IF NOT EXISTS equipped_title_id INTEGER REFERENCES title_catalog (title_id) ON DELETE SET NULL;

-- 12-month Divine-tier exclusive titles (one per 2-month season). Lower brackets reuse the season name.
INSERT INTO title_catalog (code, display, source, is_repeatable) VALUES
('divine_embercrowned',         'Embercrowned',              'rank_season', FALSE),
('divine_fimbulwinter',         'Warden of Fimbulwinter',    'rank_season', FALSE),
('divine_tempest_amihan',       'Tempest of Amihan',         'rank_season', FALSE),
('divine_asphodel',             'Throne of Asphodel',        'rank_season', FALSE),
('divine_hand_of_sidapa',       'Hand of Sidapa',            'rank_season', FALSE),
('divine_last_dawn',            'Herald of the Last Dawn',   'rank_season', FALSE),
-- a few non-season titles
('feat_godslayer',              'Godslayer',                 'boss_feat',   TRUE),
('feat_world_ender',            'World-Ender',               'boss_feat',   TRUE),
('coll_pantheon_keeper',        'Pantheon Keeper',           'collection',  TRUE);

-- ---------------------------------------------------------------------
-- D. EXCHANGE SHOP (one-way essence tier-up) — no table needed; ratios are code constants:
--    10 epic -> 1 mythic | 5 mythic -> 1 legendary | 5 legendary -> 1 supreme.  NEVER downward.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- E. RANKED REWARDS (Phase 4) — weekly by current bracket + season-end by peak bracket.
--    Payouts are JSONB so a reward can bundle credux + chests + relics + cosmetics.
-- ---------------------------------------------------------------------
CREATE TABLE ranked_reward (
    bracket            VARCHAR(10) PRIMARY KEY
        CHECK (bracket IN ('Mortal','Champion','Demigod','Ascendant','Divine')),
    weekly_credux      BIGINT NOT NULL DEFAULT 0,
    weekly_payload     JSONB  NOT NULL DEFAULT '[]'::jsonb,   -- e.g. [{"item":"gold_chest","qty":1}]
    season_end_payload JSONB  NOT NULL DEFAULT '[]'::jsonb    -- credux + relics + title + skin bundle
);
INSERT INTO ranked_reward (bracket, weekly_credux, weekly_payload, season_end_payload) VALUES
('Mortal',    5000,   '[{"item":"silver_chest","qty":1}]'::jsonb,
                      '[]'::jsonb),
('Champion',  15000,  '[{"item":"gold_chest","qty":1}]'::jsonb,
                      '[{"type":"title","code":"season_rank"}]'::jsonb),
('Demigod',   30000,  '[{"item":"boss_treasure","qty":1}]'::jsonb,
                      '[{"type":"title","code":"season_rank"},{"item":"credux","qty":50000}]'::jsonb),
('Ascendant', 60000,  '[{"item":"boss_golden","qty":1}]'::jsonb,
                      '[{"type":"title","code":"season_rank"},{"item":"supreme_chest","qty":1}]'::jsonb),
('Divine',    100000, '[{"item":"boss_golden","qty":1}]'::jsonb,
                      '[{"type":"title","code":"season_divine_exclusive"},{"item":"supreme_chest","qty":1},{"item":"supreme_relic","qty":1}]'::jsonb);
-- Weekly grant: on weekly PHT reset, to CURRENT bracket, gated by a min games-played threshold
-- (recommend >=5 ranked games that week). Season-end grant: on rollover, by PEAK bracket reached.
-- item keys above must match your real chest/relic/currency identifiers — adjust to your codebase.

COMMIT;

-- =====================================================================
-- TUNING TODO before public launch (Phase 6):
--   * Rune values above are deliberately gentle — re-check the MAX-build sum through the stat pipeline.
--   * Essence-bag costs/pools and socket-unlock costs are first-pass; balance vs essence inflow.
--   * Seasons table is empty of date rows — insert real start/end windows when you schedule S1.
-- =====================================================================
