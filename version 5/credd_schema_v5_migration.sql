-- =====================================================================
-- CREDD BOT — SCHEMA MIGRATION v4 -> v5  (GEAR OVERHAUL)
-- Reshapes the DB for: weapons = ATK+CRIT only, shields -> armor system,
-- sockets-ready gear, + optional scaffolding for pantheon / ranked / leaderboards.
-- Companion content doc: CREDD_v5_Gear_Overhaul.md
-- Run order top-to-bottom. PostgreSQL. Wrap in a transaction; review §5 first.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. WEAPONS  — remove shields, drop HP/DEF, tighten type constraint, add socket columns
-- ---------------------------------------------------------------------
-- ORDER MATTERS: shield rows must be GONE before the new type CHECK is added, or the constraint
-- fails ("violated by some row"). So we delete shields FIRST, then tighten the constraint.

-- 1a. Remove shield ownership + shield roster rows (test stage = hard delete; see §5 for prod notes).
--     FK note: user_character.equipped_weapon_id may point at a shield-backed user_weapons row.
--     Null those equips first so the DELETE doesn't trip the FK.
UPDATE user_character uc
SET equipped_weapon_id = NULL
FROM user_weapons uw
JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
WHERE uc.equipped_weapon_id = uw.weapon_id
  AND wr.type = 'Shield';

DELETE FROM user_weapons uw
USING weapon_roster wr
WHERE uw.weapon_roster_id = wr.weapon_roster_id
  AND wr.type = 'Shield';

DELETE FROM weapon_roster WHERE type = 'Shield';

-- 1b. Drop weapon HP/DEF (weapons are ATK+CRIT only now) + add socket columns.
ALTER TABLE user_weapons
    DROP COLUMN IF EXISTS curr_hp,
    DROP COLUMN IF EXISTS curr_def,
    DROP COLUMN IF EXISTS base_hp,
    DROP COLUMN IF EXISTS base_def,
    DROP COLUMN IF EXISTS bonus_crit_dmg_pct;   -- deprecated since §35.6 (v4.4)

ALTER TABLE user_weapons
    ADD COLUMN IF NOT EXISTS native_sockets   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- offensive rune slots, rolled at drop
    ADD COLUMN IF NOT EXISTS opposite_sockets JSONB NOT NULL DEFAULT '[]'::jsonb;  -- defensive slots, bought (Mythic+)

-- 1c. NOW tighten weapon types (shields are already gone, so this won't violate).
ALTER TABLE weapon_roster DROP CONSTRAINT IF EXISTS weapon_roster_type_check;
ALTER TABLE weapon_roster
    ADD CONSTRAINT weapon_roster_type_check CHECK (type IN ('Sword','Staff','Gloves','Bow'));

-- !! CODE IMPACT: combat engine, weapon-enhance, weapon-info card, dropRates banding,
--    and `crd weapon info` must stop reading weapon HP/DEF. Weapon stat sum is now ATK+CRIT only.

-- ---------------------------------------------------------------------
-- 2. ARMOR  — new roster + per-player tables + equip slot
-- ---------------------------------------------------------------------
CREATE TABLE armor_roster (
    armor_roster_id     SERIAL       PRIMARY KEY,
    name                VARCHAR(100) NOT NULL,
    type                VARCHAR(10)  NOT NULL CHECK (type IN ('Heavy','Medium','Light')),
    tier                VARCHAR(10)  NOT NULL CHECK (tier IN ('Common','Rare','Mythic','Legendary','Supreme')),
    mythology           VARCHAR(20)  NOT NULL,
    passive_key         VARCHAR(50)  NOT NULL,   -- "none" allowed; must match PASSIVE_REGISTRY
    passive_name        VARCHAR(100) NOT NULL,
    passive_description TEXT         NOT NULL,
    lore                TEXT,
    image_filename      VARCHAR(100),            -- filename only, nullable until art ready
    is_available        BOOLEAN      NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_armor_roster_tier      ON armor_roster (tier);
CREATE INDEX idx_armor_roster_mythology ON armor_roster (mythology);

CREATE TABLE user_armors (
    discord_id       VARCHAR(20)  NOT NULL REFERENCES users (discord_id),
    armor_id         VARCHAR(8)   PRIMARY KEY,                 -- app-generated 8-char unique id
    armor_roster_id  INTEGER      NOT NULL REFERENCES armor_roster (armor_roster_id),
    curr_hp          INTEGER      NOT NULL,                    -- floor(base * weaponBoostTable[enhancement])
    curr_def         INTEGER      NOT NULL,
    enhancement      SMALLINT     NOT NULL DEFAULT 1 CHECK (enhancement BETWEEN 1 AND 11),
    base_hp          INTEGER      NOT NULL,                    -- rolled on drop, static
    base_def         INTEGER      NOT NULL,
    native_sockets   JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- defensive rune slots, rolled at drop
    opposite_sockets JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- offensive slots, bought (Mythic+)
    is_locked        BOOLEAN      NOT NULL DEFAULT FALSE,        -- `crd lock`/`crd unlock`; locked = excluded from sell
    obtained_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_user_armors_owner        ON user_armors (discord_id);
CREATE INDEX idx_user_armors_owner_roster ON user_armors (discord_id, armor_roster_id);

ALTER TABLE user_character
    ADD COLUMN IF NOT EXISTS equipped_armor_id VARCHAR(8) REFERENCES user_armors (armor_id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 3. RUNE / SOCKET SCAFFOLDING  (structure only — content seeded in a follow-up)
-- ---------------------------------------------------------------------
CREATE TABLE rune_roster (
    rune_id      SERIAL       PRIMARY KEY,
    name         VARCHAR(50)  NOT NULL,
    lane         VARCHAR(10)  NOT NULL CHECK (lane IN ('offense','defense')),
    effect_key   VARCHAR(50)  NOT NULL,                        -- engine reference (e.g. 'sharpness')
    tier         VARCHAR(10)  NOT NULL CHECK (tier IN ('Common','Rare','Mythic','Legendary','Supreme')),
    value        DECIMAL(6,2) NOT NULL,                        -- magnitude (%, tune later)
    description  TEXT         NOT NULL,
    is_available BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE user_runes (
    rune_uid      VARCHAR(8)  PRIMARY KEY,                      -- app-generated 8-char unique id
    discord_id    VARCHAR(20) NOT NULL REFERENCES users (discord_id),
    rune_id       INTEGER     NOT NULL REFERENCES rune_roster (rune_id),
    socketed_into VARCHAR(8),                                   -- weapon_id or armor_id; NULL = unsocketed
    is_locked     BOOLEAN     NOT NULL DEFAULT FALSE,
    obtained_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_user_runes_owner ON user_runes (discord_id);

-- Reference seed of the 10 rune families (one Rare row each; add tiers/values when you tune them).
-- Offense lane lives in WEAPON native sockets / ARMOR opposite sockets; defense lane is the reverse.
INSERT INTO rune_roster (name, lane, effect_key, tier, value, description) VALUES
  ('Sharpness', 'offense', 'sharpness', 'Rare', 5.00, 'ATK +{value}%'),
  ('Precision', 'offense', 'precision', 'Rare', 3.00, 'CRIT +{value}%'),
  ('Vampiric',  'offense', 'vampiric',  'Rare', 3.00, 'Lifesteal {value}% of damage dealt'),
  ('Piercing',  'offense', 'piercing',  'Rare', 5.00, 'Ignore {value}% of enemy DEF'),
  ('Venom',     'offense', 'venom',     'Rare', 5.00, 'Flat DOT {value}% ATK/turn on hit'),
  ('Vitality',  'defense', 'vitality',  'Rare', 5.00, 'HP +{value}%'),
  ('Bulwark',   'defense', 'bulwark',   'Rare', 5.00, 'DEF +{value}%'),
  ('Thorns',    'defense', 'thorns',    'Rare', 5.00, 'Reflect {value}% of damage taken'),
  ('Warding',   'defense', 'warding',   'Rare', 10.00,'Incoming DOT reduced by {value}%'),
  ('Aegis',     'defense', 'aegis_rune','Rare', 3.00, 'Incoming damage reduced by {value}%');

-- ---------------------------------------------------------------------
-- 4. BROADER v5 SCAFFOLDING  (OPTIONAL — additive columns for the locked design;
--    safe to run now, or comment out to ship gear-only first)
-- ---------------------------------------------------------------------
-- Pantheon: support deity slots 2 & 3 (main stays active_deity_id)
ALTER TABLE user_character
    ADD COLUMN IF NOT EXISTS active_deity_id_2 INTEGER REFERENCES user_deities (user_deity_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS active_deity_id_3 INTEGER REFERENCES user_deities (user_deity_id) ON DELETE SET NULL;

-- Ranked PvP (Elo) + leaderboard counters
ALTER TABLE user_character
    ADD COLUMN IF NOT EXISTS pvp_rating INTEGER NOT NULL DEFAULT 1000,
    ADD COLUMN IF NOT EXISTS boss_kills INTEGER NOT NULL DEFAULT 0;        -- participation kills only (boss died + you attacked)

-- Leaderboard: lifetime credux EARNED (grind/sell/quest/daily/boss). Bestow/wager/casino NOT counted.
ALTER TABLE users_bag
    ADD COLUMN IF NOT EXISTS lifetime_credux_earned BIGINT NOT NULL DEFAULT 0;

-- Deity-blessing scaling tag for pantheon support slots (binary blessings don't scale; main-slot only).
ALTER TABLE deity_roster
    ADD COLUMN IF NOT EXISTS blessing_scaling VARCHAR(10) NOT NULL DEFAULT 'scalable'
        CHECK (blessing_scaling IN ('scalable','binary'));
-- TODO: UPDATE deity_roster SET blessing_scaling='binary' for once-per-battle / immunity / survive-lethal
--       blessings (Sidapa, Baldur, Idunn, Persephone, Freya, Alan's-style immunities, etc.).

-- ---------------------------------------------------------------------
-- 5. SHIELD -> ARMOR DATA MIGRATION  (now handled in §1a — kept here for production notes)
-- ---------------------------------------------------------------------
-- TEST STAGE (what §1a does): hard-delete shield ownership + shield roster rows. Shields are
-- re-authored as armor_roster rows in §6, so nothing is lost but test ownership.
--
-- PRODUCTION (if you ever run this on live data instead): do NOT hard-delete owned shields.
-- Instead, for each user_weapons shield row, INSERT an equivalent user_armors row (map the shield's
-- stats/enhancement), repoint any equips, THEN delete the weapon rows and the roster rows. Skipped
-- here because we're in testing and re-seeding is simpler.

-- ---------------------------------------------------------------------
-- 6. ARMOR_ROSTER SEED  (image_filename NULL until art ready; adjust mythology tags to match your DB)
--    [NEW] passives need passiveRegistry.js functions (see spec §E) before they do anything.
-- ---------------------------------------------------------------------
INSERT INTO armor_roster (name, type, tier, mythology, passive_key, passive_name, passive_description) VALUES
-- Common (starter)
('Initiate''s Garb',       'Medium', 'Common',   'Common', 'none',                  'None',                  'Plain travelling garb. No special property.'),
-- Rare
('Steel Kite Shield',      'Heavy',  'Rare',      'Common', 'steel_kite_shield',     'Bulwark',               '10% chance to block 15% of incoming damage.'),
('Kalasag',                'Heavy',  'Rare',      'PH',     'kalasag',               'Bulwark Hide',          'Reduces incoming damage by 3%.'),
('Iron Buckler',           'Medium', 'Rare',      'Common', 'none',                  'None',                  'A simple buckler. No special property.'),
('Reinforced Targe',       'Medium', 'Rare',      'Common', 'reinforced_targe',      'Opening Strike',        'The first hit deals +20% ATK.'),
('Wooden Shield',          'Light',  'Rare',      'Common', 'none',                  'None',                  'A basic wooden shield. No special property.'),
('Baluti Vest',            'Light',  'Rare',      'PH',     'none',                  'None',                  'Woven abaca-and-hide vest. No special property.'),
-- Mythic
('Vatican Aspis',          'Heavy',  'Mythic',    'Other',  'vatican_aspis',         'Sacred Guard',          'Reduces all damage taken by 10% and grants +10% ATK.'),
('Battersea Shield',       'Heavy',  'Mythic',    'Other',  'battersea_shield',      'Iron Stance',           'DEF +25% for the first 2 turns.'),
('Dipylon Shield',         'Heavy',  'Mythic',    'Greek',  'dipylon_shield',        'Hoplite Wall',          'DEF +20% for the first 3 turns.'),
('Enderby Shield',         'Medium', 'Mythic',    'Norse',  'enderby_shield',        'Thornward',             '10% chance to reflect 30% of incoming damage back to the attacker.'),
('Salakot Ward',           'Medium', 'Mythic',    'PH',     'salakot_ward',          'Spirit Ward',           '20% chance to negate an incoming debuff.'),
('Pelte',                  'Light',  'Mythic',    'Greek',  'pelte',                 'Deflection',            '15% chance to block 25% of incoming damage.'),
('Wolfskin Cloak',         'Light',  'Mythic',    'Norse',  'wolfskin_cloak',        'Wolf''s Vigor',         'Regenerates 10% max HP at the start of each turn.'),
-- Legendary
('Shield of the Valkyrie', 'Heavy',  'Legendary', 'Norse',  'shield_of_the_valkyrie','Valkyrie''s Resolve',   'Each hit taken grants +5% DEF and +5% ATK, stacking up to 30% each.'),
('Hoplite Panoply',        'Heavy',  'Legendary', 'Greek',  'hoplite_panoply',       'Phalanx Wall',          'Reduces incoming damage by 15%.'),
('Skjaldmaer',             'Medium', 'Legendary', 'Norse',  'skjaldmaer',            'Shieldmaiden''s Guard', '15% chance to ignore incoming damage entirely.'),
('Luzon Tribal Shield',    'Medium', 'Legendary', 'PH',     'luzon_tribal_shield',   'Tribal Ward',           'While debuffed, gains +40% DEF until the debuff expires.'),
('Anting-Anting Sash',     'Light',  'Legendary', 'PH',     'anting_anting_sash',    'Charmed Hide',          'Immunity to Stun, Petrify, and Freeze.'),
('Valkyrie''s Mantle',     'Light',  'Legendary', 'Norse',  'valkyrie_mantle',       'Chooser''s Grace',      '20% chance to evade an incoming attack.'),
-- Supreme
('Aegis',                  'Heavy',  'Supreme',   'Greek',  'aegis',                 'Medusa''s Gaze',        '50% chance on hit to add a Stone stack; at 3 stacks, stuns for 1 turn, then resets.'),
('Mail of Brokkr',         'Heavy',  'Supreme',   'Norse',  'mail_of_brokkr',        'Dwarven Forge',         'Reduces all incoming damage by 30% and reflects 15% of damage taken.'),
('Mantle of Bathala',      'Medium', 'Supreme',   'PH',     'mantle_of_bathala',     'Divine Aegis',          'Increases HP and DEF by 5% every turn, stacking up to +100% each.'),
('Helm of Darkness',       'Light',  'Supreme',   'Greek',  'helm_of_darkness',      'Invisibility',          '30% chance each turn to reduce enemy DEF by 50% for 2 turns.');

COMMIT;

-- =====================================================================
-- POST-MIGRATION TODO (code, not schema):
--   * Update combat engine / stat-sum to read weapon ATK+CRIT and armor HP+DEF (two slots).
--   * Add `crd bag armors`, `crd equip` (armor), armor info card, armor enhance, armor lock/sell.
--   * Update dropRates banding: weapons §B.3, armor §C.1 of the spec doc.
--   * Grant Initiate's Garb at `crd create character` (alongside Initiate's Blade).
--   * Implement the [NEW] passiveRegistry.js functions (spec §E).
--   * Add Heavy/Medium/Light + native-socket-count rolls to the armor/weapon drop generator.
--   * Tag deity_roster.blessing_scaling = 'binary' where applicable.
--   * POWER-BUDGET RETUNE before launch: re-tune boss HP/ATK/DEF for pantheon + sockets + armor;
--     cap total evade at 40%; cap combined damage-reduction.
-- =====================================================================
