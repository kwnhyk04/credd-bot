# CREDD BOT — TECHNICAL BLUEPRINT & DATABASE SCHEMA v4
### The Last Believer RPG Discord Bot
**Updated:** Decision Log v1 fully applied — schema sync with credd_schema_v4.sql, essence system, duel-in-memory / boss-persisted battles, per-spawn boss scoping, global boss lock, daily-claim + reputation-cap fields, user_guild_activity table, enhancement boost-table (linear formula removed), round/attack counters, special_flags, "none" sentinels, deity surrogate key.

---

## 1. SYSTEM ARCHITECTURE

### High-Level Overview

```
Discord Server
     │
     ▼
discord.js Client (Node.js)
     │
     ├── Command Handler
     │     ├── RPG Commands      (raid, duel, summon, enhance, deity, bag, profile)
     │     ├── Economy Commands  (cred, bestow, daily, quests)
     │     ├── Casino Commands   (coin toss, dice roll, baccarat, blackjack, slot, crash)
     │     ├── Admin Commands    (setprefix, setbotchannel, setannouncementchannel, stats)
     │     └── Dev Commands      (ban, unban, reset, give, enhanceweapon, enhancedeity)
     │
     ├── Middleware (runs before every command)
     │     ├── Ban Check         (query users.is_banned — fast, lean table)
     │     ├── Registration Check (redirect unregistered to crd register)
     │     ├── Character Check   (redirect to crd create character if no character)
     │     └── Cooldown Check    (10 seconds universal)
     │
     ├── Event Handler
     │     ├── Battle Engine     (auto-battle loop, turn processor, debuff tracker)
     │     ├── Passive Registry  (PASSIVE_REGISTRY — all weapon/deity/mob skill logic)
     │     ├── Boss Scheduler    (15min spawn timer, 1hr escape timer)
     │     └── Reset Scheduler   (midnight PHT daily/quest reset)
     │
     ├── Canvas Renderer (node-canvas)
     │     ├── Profile Card PNG
     │     ├── Deity Info Card PNG
     │     └── Weapon Info Card PNG
     │
     ├── Animation Engine
     │     ├── Gacha flip        (edit-based PNG swap)
     │     ├── Chest opening     (edit-based PNG swap)
     │     └── Relic opening     (edit-based PNG swap)
     │
     └── PostgreSQL (via pg / node-postgres)
           ├── users                  (core account — ban check)
           ├── users_bag              (currencies + chests)
           ├── user_character         (RPG stats)
           ├── user_weapons           (player-owned weapons)
           ├── user_deities           (player-owned deities)
           ├── weapon_roster          (weapon reference data)
           ├── deity_roster           (deity reference data)
           ├── mob_roster             (mob/elite/boss reference data)
           ├── pity_counters          (gacha pity — backend only)
           ├── active_battles         (live battle state)
           ├── boss_state             (server boss shared HP pool)
           ├── boss_attack_log        (per-player boss damage)
           ├── daily_quests           (3 quests per player per day)
           ├── server_config          (per-server settings)
           ├── user_guild_activity    (per-guild activity — server avg level + admin stats)
           ├── raid_logs              (PvE battle results)
           ├── pvp_logs               (PvP duel results)
           ├── game_logs              (economy audit trail)
           ├── casino_logs            (casino audit trail)
           └── dev_logs               (dev action audit trail)
```

### Component Interactions

| Component | Talks To | Purpose |
|---|---|---|
| Middleware | `users` | Lean ban check on every command |
| Command Handler | PostgreSQL | Read/write player data per command |
| Battle Engine | `user_character`, `user_weapons`, `user_deities`, `mob_roster`, `active_battles` | Load stats, run turns, persist state |
| Passive Registry | Battle Engine | Maps passive_key/blessing_key/skill_key → code logic |
| Boss Scheduler | `boss_state`, `boss_attack_log`, `server_config` | Spawn, track damage, distribute rewards |
| Reset Scheduler | `daily_quests`, `users`, `user_character` | Reset at midnight PHT (streaks, quest rollover, bestow + reputation daily counters) |
| Middleware | `user_guild_activity` | Upsert last_active per (user, guild) on every command |
| Canvas Renderer | PostgreSQL + Discord API | Fetch data + avatar, generate PNG |
| Animation Engine | Discord CDN / Cloudflare R2 | Swap PNG frames via message.edit() |
| Casino Handler | `users_bag`, `casino_logs` | Deduct bet, resolve, credit winnings |

### Key Design Decisions

- **Lean ban check** — `users` table is kept small so ban check middleware runs fast on every command
- **Separated bag** — `users_bag` holds currencies/chests/essence separately from core account data
- **Roster tables in DB** — `weapon_roster`, `deity_roster`, `mob_roster` store all static reference data (stats, lore, passives) — adding new mythologies = just inserting rows, zero code changes
- **Passive Registry pattern** — `passive_key`, `blessing_key`, `skill_key` map to code functions in one registry file. `"none"` is a valid sentinel handled by a shared no-op. (Full registry spec lives in Master §35.)
- **curr_atk/curr_hp/curr_def stored** — enhanced stats stored in DB after each enhancement event. Computed as `floor(base × boostTable[enhancement])` — **boost table lookup, NOT a linear formula** (weapon +10 = ×2.00, deity +10 = ×2.00)
- **Enhancement default = 1** — stored as 1–11, displayed as +0 to +10 (display = stored − 1)
- **Essence model** — owning a deity is binary (one row in `user_deities`). Duplicate pulls convert to **tier essence** (Epic/Mythic/Legendary/Supreme) stored in `users_bag`; deity enhancement spends essence. No per-deity duplicate counter.
- **Battle persistence split** — raids and boss fights persist in `active_battles` (rewards at stake, restart-safe). **Duels run fully in-memory** (friendly, 0 EXP) and are not persisted; concurrency guarded by an in-process busy-set. `battle_type` domain = {raid, boss}.
- **`current_turn` = ROUND counter** and is the only periodic clock; all "every Nth" effects are round-based, "first hit" effects use a first-action flag (per Master §35.1). The old per-attack counter columns are removed.
- **Battle termination** — from round 30, both combatants lose 10% max HP/round (sudden-death drain); hard backstop at round 50
- **Boss HP server-scoped** — one row per server in `boss_state`; `spawn_id` (regenerated each spawn) scopes per-spawn damage in `boss_attack_log`
- **Global boss lock** — `users.last_boss_attack_date` enforces one boss attack per player per day across all servers
- **Server average level** — `AVG(combat_level)` of users active in that guild within 7 days (inner-join `user_character`, so registered-but-character-less accounts are excluded); if there are no active players, **skip the boss spawn**
- **All logs immutable** — insert-only, never updated; no FK so they survive player deletion
- **Timezone** — all resets anchored to PHT (UTC+8)

---

## 2. DATABASE DESIGN

### 2.1 Chosen Database Type

**PostgreSQL (Relational SQL)**

**Justification:**
- Highly relational data (users → characters → weapons → deities → logs)
- ACID compliance critical for economy transactions (Credux transfers, bets, enhancements)
- FK constraints enforce data integrity
- JSONB for flexible fields (debuffs, battle logs, metadata)
- Complex queries needed for boss participation tracking (per-spawn attacker set)
- Roster tables make future mythology additions zero-code

---

### 2.2 Entity-Relationship Design

---

#### TABLE: `users`
*Lean core account table. Checked on every command for ban status.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `discord_id` | VARCHAR(20) | PRIMARY KEY | Discord snowflake ID |
| `username` | VARCHAR(100) | NOT NULL | Display name at registration |
| `monthly_streak` | SMALLINT | NOT NULL DEFAULT 0 | 0–30, fixed 30-day rolling cycle (loops 30→1); miss a day → reset to 1 |
| `overall_streak` | INTEGER | NOT NULL DEFAULT 0 | Lifetime consecutive days |
| `last_daily_claim_date` | DATE | NULLABLE | PHT date of last `crd daily`; drives streak + dup-claim check |
| `last_bestow_received` | DATE | NULLABLE | For 1M/day receiver-cap enforcement |
| `bestow_received_today` | BIGINT | NOT NULL DEFAULT 0 | Running total today (lazy-reset when date rolls) |
| `last_boss_attack_date` | DATE | NULLABLE | Global cross-server boss lock (one attack/day) |
| `is_banned` | BOOLEAN | NOT NULL DEFAULT FALSE | Global ban flag |
| `registered_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Indexes:**
- PRIMARY KEY on `discord_id`
- INDEX on `is_banned` (every command hits this)

---

#### TABLE: `users_bag`
*All currencies, relics, and chests. Separate from users for query efficiency.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `discord_id` | VARCHAR(20) | PRIMARY KEY, FK → users | |
| `credux` | BIGINT | NOT NULL DEFAULT 0 | |
| `belief_shards` | INTEGER | NOT NULL DEFAULT 0 | Granted (1,000) at character creation — not registration |
| `sacred_relics` | INTEGER | NOT NULL DEFAULT 0 | |
| `supreme_relics` | INTEGER | NOT NULL DEFAULT 0 | |
| `silver_chest` | INTEGER | NOT NULL DEFAULT 0 | Granted (10) at character creation — not registration |
| `gold_chest` | INTEGER | NOT NULL DEFAULT 0 | |
| `boss_treasure_chest` | INTEGER | NOT NULL DEFAULT 0 | |
| `boss_golden_chest` | INTEGER | NOT NULL DEFAULT 0 | |
| `supreme_chest` | INTEGER | NOT NULL DEFAULT 0 | |
| `epic_essence` | INTEGER | NOT NULL DEFAULT 0 | Duplicate Epic deity pulls convert here |
| `mythic_essence` | INTEGER | NOT NULL DEFAULT 0 | Duplicate Mythic (Awakened) pulls |
| `legendary_essence` | INTEGER | NOT NULL DEFAULT 0 | Duplicate Legendary (Undying) pulls |
| `supreme_essence` | INTEGER | NOT NULL DEFAULT 0 | Duplicate Supreme (Primordial) pulls |

**Indexes:**
- PRIMARY KEY on `discord_id`

---

#### TABLE: `user_character`
*RPG character data. Created on `crd create character`.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `discord_id` | VARCHAR(20) | PRIMARY KEY, FK → users | |
| `class` | VARCHAR(20) | NOT NULL | Swordsman/Fighter/Mage/Knight/Archer |
| `combat_level` | SMALLINT | NOT NULL DEFAULT 1 | 1–50 |
| `combat_exp` | BIGINT | NOT NULL DEFAULT 0 | EXP toward next combat level |
| `equipped_weapon_id` | VARCHAR(8) | NULLABLE, FK → user_weapons ON DELETE SET NULL | Starter weapon on creation; auto-nulled if the weapon row is sold/deleted |
| `active_deity_id` | INTEGER | NULLABLE, FK → user_deities(user_deity_id) ON DELETE SET NULL | Set via `crd deity equip`; auto-set to first summoned if none; auto-nulled if that deity row is removed |
| `raids_won` | INTEGER | NOT NULL DEFAULT 0 | |
| `raids_lost` | INTEGER | NOT NULL DEFAULT 0 | |
| `pvp_wins` | INTEGER | NOT NULL DEFAULT 0 | |
| `pvp_losses` | INTEGER | NOT NULL DEFAULT 0 | |
| `believer_level` | INTEGER | NOT NULL DEFAULT 1 | Reputation level — unlimited |
| `believer_exp` | BIGINT | NOT NULL DEFAULT 0 | 3,000 per level flat |
| `reputation_exp_today` | INTEGER | NOT NULL DEFAULT 0 | Daily reputation EXP earned (5,000/day cap) |
| `reputation_exp_reset_date` | DATE | NULLABLE | PHT anchor for the daily cap reset |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Indexes:**
- PRIMARY KEY on `discord_id`
- INDEX on `combat_level` (boss level scaling uses server average)

---

#### TABLE: `user_weapons`
*Every player-owned weapon. One row per weapon drop — never shared.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `discord_id` | VARCHAR(20) | NOT NULL, FK → users | Owner — listed first for query readability |
| `weapon_id` | VARCHAR(8) | PRIMARY KEY | UUID 8-char, globally unique |
| `weapon_roster_id` | INTEGER | NOT NULL, FK → weapon_roster | Links to name, lore, passive info |
| `curr_atk` | INTEGER | NOT NULL | floor(base_atk × weaponBoostTable[enhancement]) |
| `curr_hp` | INTEGER | NOT NULL | floor(base_hp × weaponBoostTable[enhancement]) |
| `curr_def` | INTEGER | NOT NULL | floor(base_def × weaponBoostTable[enhancement]) |
| `enhancement` | SMALLINT | NOT NULL DEFAULT 1 | Stored 1–11, displayed as enhancement-1 (+0 to +10) |
| `base_atk` | INTEGER | NOT NULL | Rolled on drop — static |
| `base_hp` | INTEGER | NOT NULL | Rolled on drop — static |
| `base_def` | INTEGER | NOT NULL | Rolled on drop — static |
| `crit` | DECIMAL(4,1) | NOT NULL | Rolled on drop |
| `bonus_dmg_pct` | DECIMAL(5,2) | NULLABLE | Legendary 1% bonus roll |
| `bonus_crit_dmg_pct` | DECIMAL(5,2) | NULLABLE | Legendary 1% bonus roll |
| `is_locked` | BOOLEAN | NOT NULL DEFAULT FALSE | `crd lock`/`crd unlock`; locked = excluded from `crd sell` |
| `obtained_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Indexes:**
- PRIMARY KEY on `weapon_id`
- INDEX on `discord_id` (bag queries)
- INDEX on `(discord_id, weapon_roster_id)` for tier/type filtered bag

**Enhancement (boost-table lookup — NOT a linear formula):**
```
curr_atk = floor(base_atk × weaponBoostTable[enhancement])

The old linear `base × (1 + (enhancement-1) × 0.05)` is REMOVED — it only reached
×1.50 at +10 and contradicted the boost table. The boost table below is authoritative.
Stored enhancement 1 → display +0 → ×1.00
Stored enhancement 11 → display +10 → ×2.00 (full double)
```

**Full Weapon Boost Table:**
| Stored | Display | Multiplier |
|---|---|---|
| 1 | +0 | ×1.00 |
| 2 | +1 | ×1.05 |
| 3 | +2 | ×1.10 |
| 4 | +3 | ×1.15 |
| 5 | +4 | ×1.20 |
| 6 | +5 | ×1.25 |
| 7 | +6 | ×1.32 |
| 8 | +7 | ×1.40 |
| 9 | +8 | ×1.50 |
| 10 | +9 | ×1.70 |
| 11 | +10 | ×2.00 |

---

#### TABLE: `user_deities`
*Every player-owned deity. One row per unique deity per player. Owning is binary — duplicates become tier essence in `users_bag`.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `user_deity_id` | SERIAL | PRIMARY KEY | Surrogate key — target of `user_character.active_deity_id` |
| `discord_id` | VARCHAR(20) | NOT NULL, FK → users | Owner |
| `deity_id` | INTEGER | NOT NULL, FK → deity_roster | Links to base stats, lore, blessing |
| `curr_atk` | INTEGER | NOT NULL | floor(base_atk × deityBoostTable[enhancement]) |
| `curr_hp` | INTEGER | NOT NULL | floor(base_hp × deityBoostTable[enhancement]) |
| `curr_def` | INTEGER | NOT NULL | floor(base_def × deityBoostTable[enhancement]) |
| `enhancement` | SMALLINT | NOT NULL DEFAULT 1 | Stored 1–11, displayed as enhancement-1 |
| `obtained_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | First pull date |
| `last_pull_date` | DATE | NOT NULL | Most recent pull date for this specific deity |

> `duplicate_count` is **removed** (GACHA-2). Pulling a deity you already own grants +1 essence of that deity's tier instead. Enhancement spends essence (see deityEnhancement.js), uniform +10%/level on all three stats.

**Indexes:**
- PRIMARY KEY on `user_deity_id`
- UNIQUE on `(discord_id, deity_id)` — one owned row per deity
- INDEX on `discord_id`

**Enhancement (uniform, boost-table lookup):**
```
curr_atk = floor(base_atk × deityBoostTable[enhancement])   // +10%/level, all stats
Stored enhancement 1 → display +0 → ×1.00
Stored enhancement 11 → display +10 → ×2.00 (100% boost)
```

**Full Deity Boost Table:**
| Stored | Display | Multiplier |
|---|---|---|
| 1 | +0 | ×1.00 |
| 2 | +1 | ×1.10 |
| 3 | +2 | ×1.20 |
| 4 | +3 | ×1.30 |
| 5 | +4 | ×1.40 |
| 6 | +5 | ×1.50 |
| 7 | +6 | ×1.60 |
| 8 | +7 | ×1.70 |
| 9 | +8 | ×1.80 |
| 10 | +9 | ×1.90 |
| 11 | +10 | ×2.00 |

---

#### TABLE: `weapon_roster`
*Static weapon reference data. Shared across all players.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `weapon_roster_id` | SERIAL | PRIMARY KEY | Starts from 1 |
| `name` | VARCHAR(100) | NOT NULL | e.g. "Freyr's Arrow" |
| `type` | VARCHAR(10) | NOT NULL | Sword/Staff/Gloves/Shield/Bow |
| `tier` | VARCHAR(10) | NOT NULL | Common/Rare/Mythic/Legendary/Supreme |
| `mythology` | VARCHAR(20) | NOT NULL | PH/Norse/Greek/Common/etc. |
| `passive_key` | VARCHAR(50) | NOT NULL | e.g. "freyrs_arrow" — battle engine ref; `"none"` for no passive |
| `passive_name` | VARCHAR(100) | NOT NULL | "Auto-Fire" |
| `passive_description` | TEXT | NOT NULL | Full description shown in weapon info |
| `lore` | TEXT | NULLABLE | Flavor/educational text |
| `image_filename` | VARCHAR(100) | NULLABLE | "freyrs_arrow.png" |
| `is_available` | BOOLEAN | NOT NULL DEFAULT TRUE | Retire a weapon = set FALSE (soft-delete; excluded from chest pool, never DELETE owned rows) |

**Indexes:**
- PRIMARY KEY on `weapon_roster_id`
- INDEX on `tier` (chest drop queries: WHERE tier = 'Legendary')
- INDEX on `mythology`

**Usage:**
- Chest opens → `SELECT * FROM weapon_roster WHERE tier = 'Legendary' AND is_available = TRUE ORDER BY RANDOM() LIMIT 1`
- `crd weapon info` → `SELECT uw.*, wr.name, wr.lore, wr.passive_description, wr.image_filename FROM user_weapons uw INNER JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id WHERE uw.weapon_id = $1`

---

#### TABLE: `deity_roster`
*Static deity reference data. Shared across all players.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `deity_id` | SERIAL | PRIMARY KEY | Starts from 1 |
| `name` | VARCHAR(100) | NOT NULL UNIQUE | Unique display name |
| `mythology` | VARCHAR(20) | NOT NULL | PH/Norse/Greek/etc. |
| `tier` | VARCHAR(10) | NOT NULL | Epic/Mythic/Legendary/Supreme |
| `base_hp` | INTEGER | NOT NULL | Fixed base stat |
| `base_atk` | INTEGER | NOT NULL | Fixed base stat |
| `base_def` | INTEGER | NOT NULL | Fixed base stat |
| `blessing_key` | VARCHAR(50) | NOT NULL | e.g. "divine_vessel" — battle engine ref |
| `blessing_name` | VARCHAR(100) | NOT NULL | "Divine Vessel" |
| `blessing_description` | TEXT | NOT NULL | Full description shown in deity info |
| `lore` | TEXT | NULLABLE | Educational mythological description |
| `image_filename` | VARCHAR(100) | NULLABLE | "bathala.png" |
| `is_available` | BOOLEAN | NOT NULL DEFAULT TRUE | Retire a deity = set FALSE (soft-delete; hidden from gacha pool, never DELETE owned rows) |

**Indexes:**
- PRIMARY KEY on `deity_id`
- INDEX on `tier` (gacha roll: WHERE tier = 'Legendary')
- INDEX on `mythology` (collection pagination)

**Usage:**
- Gacha Legendary proc → `SELECT * FROM deity_roster WHERE tier = 'Legendary' AND is_available = TRUE ORDER BY RANDOM() LIMIT 1`
- `crd deity info` → `SELECT ud.*, dr.name, dr.mythology, dr.base_hp, dr.base_atk, dr.base_def, dr.blessing_name, dr.blessing_description, dr.lore, dr.image_filename FROM user_deities ud INNER JOIN deity_roster dr ON ud.deity_id = dr.deity_id WHERE ud.discord_id = $1 AND dr.name ILIKE $2`

---

#### TABLE: `mob_roster`
*Static mob/elite/boss reference data.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `mob_id` | SERIAL | PRIMARY KEY | Starts from 1 |
| `name` | VARCHAR(100) | NOT NULL | e.g. "Manananggal" |
| `mythology` | VARCHAR(20) | NOT NULL | PH/Norse/Greek/etc. |
| `mob_type` | VARCHAR(10) | NOT NULL | regular/elite/boss |
| `base_hp` | INTEGER | NOT NULL | |
| `base_atk` | INTEGER | NOT NULL | |
| `base_def` | INTEGER | NOT NULL | |
| `base_crit` | DECIMAL(4,1) | NOT NULL | Boss crit read live from here (no scaling) |
| `hp_per_level` | INTEGER | NOT NULL DEFAULT 0 | Seed regular=20 / elite=38 / boss=authored |
| `atk_per_level` | INTEGER | NOT NULL DEFAULT 0 | Seed regular=8 / elite=10 / boss=authored |
| `def_per_level` | INTEGER | NOT NULL DEFAULT 0 | Seed regular=5 / elite=8 / boss=authored |
| `skill_key` | VARCHAR(50) | NOT NULL | e.g. "viscera_drain"; `"none"` for basic-attack-only bosses |
| `skill_name` | VARCHAR(100) | NOT NULL | "Viscera Drain" |
| `skill_description` | TEXT | NOT NULL | Full description |
| `immunity_tags` | JSONB | NOT NULL DEFAULT '[]' | Tags from the fixed vocabulary, or ["all_debuffs"]. All bosses auto-immune to hp_pct_dot |
| `special_flags` | JSONB | NOT NULL DEFAULT '{}' | Non-skill boss mechanics e.g. {"first_strike":true} / {"multi_attack":2,"multi_attack_pct":0.60} |
| (no lore / image) | — | — | Mobs are grind fodder — intentionally have no lore or art |

**Indexes:**
- PRIMARY KEY on `mob_id`
- INDEX on `mob_type` (spawn roll: WHERE mob_type = 'regular')
- INDEX on `mythology`

**Usage:**
- Raid spawn regular → `SELECT * FROM mob_roster WHERE mob_type = 'regular' ORDER BY RANDOM() LIMIT 1`
- Raid spawn elite → `SELECT * FROM mob_roster WHERE mob_type = 'elite' ORDER BY RANDOM() LIMIT 1`
- Boss spawn → `SELECT * FROM mob_roster WHERE mob_type = 'boss' ORDER BY RANDOM() LIMIT 1`

---

#### TABLE: `pity_counters`
*Gacha pity tracking. Backend only — never exposed to players.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `discord_id` | VARCHAR(20) | PRIMARY KEY, FK → users | |
| `pity_count` | SMALLINT | NOT NULL DEFAULT 0 | Increments per roll; resets to 0 on ANY Legendary or Supreme pull (natural or forced) |

**Notes:**
- Checked per individual roll (not per batch)
- At 500 → force Legendary tier → reset to 0
- Any natural Legendary or Supreme pull also resets to 0
- Supreme has no pity of its own — raw 1% luck only

---

#### TABLE: `active_battles`
*Live raid/boss state. Deleted on completion. Duels are NOT stored here (in-memory).*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `battle_id` | SERIAL | PRIMARY KEY | |
| `discord_id` | VARCHAR(20) | NOT NULL, FK → users | UNIQUE — one active battle per player |
| `channel_id` | VARCHAR(20) | NOT NULL | Discord channel |
| `message_id` | VARCHAR(20) | NOT NULL | Discord message being edited |
| `battle_type` | VARCHAR(10) | NOT NULL | raid / boss (duel removed — runs in-memory) |
| `mob_id` | INTEGER | NOT NULL, FK → mob_roster | Mob or boss being fought (boss is in mob_roster) |
| `enemy_level` | SMALLINT | NOT NULL | Computed on battle start |
| `player_hp` | INTEGER | NOT NULL | Current |
| `player_max_hp` | INTEGER | NOT NULL | |
| `enemy_hp` | INTEGER | NOT NULL | Current (boss: display mirror of shared pool) |
| `enemy_max_hp` | INTEGER | NOT NULL | |
| `current_turn` | SMALLINT | NOT NULL DEFAULT 1 | ROUND counter — the only periodic clock (§35.1) |
| `player_goes_first` | BOOLEAN | NOT NULL | Result of first attack roll |
| `active_debuffs` | JSONB | NOT NULL DEFAULT '[]' | [{type, turns_remaining, value}] |
| `battle_log` | JSONB | NOT NULL DEFAULT '[]' | Per-turn log entries |
| `overcharge_pct` | SMALLINT | NOT NULL DEFAULT 0 | Mage passive state |
| `bleed_stacks` | JSONB | NOT NULL DEFAULT '[]' | Swordsman DOT state |
| `started_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Also used by startup/stale-battle cleanup |

**Indexes:**
- PRIMARY KEY on `battle_id`
- UNIQUE on `discord_id`
- INDEX on `channel_id`

---

#### TABLE: `boss_state`
*One active boss per server at a time.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `guild_id` | VARCHAR(20) | PRIMARY KEY | Discord server ID |
| `spawn_id` | UUID | NOT NULL DEFAULT gen_random_uuid() | New per spawn — scopes boss_attack_log |
| `mob_id` | INTEGER | NOT NULL, FK → mob_roster | Boss reference |
| `boss_level` | SMALLINT | NOT NULL | Server avg level + random(1–10) |
| `max_hp` | BIGINT | NOT NULL | Computed on spawn |
| `current_hp` | BIGINT | NOT NULL | Shared pool |
| `scaled_atk` | INTEGER | NOT NULL | Post-scaling snapshot (base + per_level × boss_level) |
| `scaled_def` | INTEGER | NOT NULL | Post-scaling snapshot |
| `spawn_at` | TIMESTAMPTZ | NOT NULL | |
| `expires_at` | TIMESTAMPTZ | NOT NULL | spawn_at + 1 hour |
| `status` | VARCHAR(10) | NOT NULL DEFAULT 'active' | active / dead / escaped |

**Notes:** Boss CRIT is read live from `mob_roster.base_crit` (doesn't scale). `boss_state` is one row per guild, updated in place; a new `spawn_id` is generated each spawn. Announcement channel in `server_config.boss_announcement_channel_id` (falls back to `announcement_channel_id`).

---

#### TABLE: `boss_attack_log`
*Per-player participation tracking per spawn (who attacked this spawn → reward payout on kill). No top-damage reward.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | |
| `boss_spawn_id` | UUID | NOT NULL | Scopes a single spawn (= boss_state.spawn_id at attack time) |
| `guild_id` | VARCHAR(20) | NOT NULL | No FK — history preserved across respawns |
| `discord_id` | VARCHAR(20) | NOT NULL, FK → users | |
| `mob_id` | INTEGER | NOT NULL | Boss snapshot |
| `total_damage` | BIGINT | NOT NULL DEFAULT 0 | Cumulative this spawn |
| `attacked_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | First attack timestamp |
| `last_daily_reset` | DATE | NOT NULL | Daily lock reference |

**Indexes:**
- UNIQUE on `(boss_spawn_id, discord_id)` — one attacker row per spawn
- INDEX on `(boss_spawn_id)` — list participants for reward payout (no top-damage reward)

> Global one-attack-per-day lock is enforced via `users.last_boss_attack_date`, not this table.

---

#### TABLE: `daily_quests`
*3 active quests per player per day.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | |
| `discord_id` | VARCHAR(20) | NOT NULL, FK → users | |
| `quest_type` | VARCHAR(30) | NOT NULL | raid_wins/elite_defeats/credux_spent/weapon_enhancements/duel_wins/duel_challenges |
| `target_count` | SMALLINT | NOT NULL | Randomized within range on rollover |
| `current_count` | SMALLINT | NOT NULL DEFAULT 0 | Progress |
| `reward_credux` | INTEGER | NOT NULL | |
| `reward_belief_shards` | SMALLINT | NOT NULL | |
| `completed` | BOOLEAN | NOT NULL DEFAULT FALSE | |
| `quest_date` | DATE | NOT NULL | PHT date |

**Indexes:**
- INDEX on `(discord_id, quest_date)`
- UNIQUE on `(discord_id, quest_type, quest_date)` — no duplicate types per day

---

#### TABLE: `server_config`
*Per-server settings.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `guild_id` | VARCHAR(20) | PRIMARY KEY | |
| `prefix` | VARCHAR(5) | NOT NULL DEFAULT 'crd' | |
| `announcement_channel_id` | VARCHAR(20) | NULLABLE | General bot announcements |
| `boss_announcement_channel_id` | VARCHAR(20) | NULLABLE | Boss spawn/death/escape specifically |
| `bot_channel_id` | VARCHAR(20) | NULLABLE | Restrict commands to this channel |
| `configured_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

---

#### TABLE: `user_guild_activity`
*Per-(user, guild) activity. Powers server-average boss level and admin active-player stats.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `discord_id` | VARCHAR(20) | NOT NULL, FK → users | |
| `guild_id` | VARCHAR(20) | NOT NULL | |
| `last_active` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Upserted by middleware every command |

**Indexes:**
- PRIMARY KEY on `(discord_id, guild_id)`
- INDEX on `(guild_id, last_active)`

**Usage:**
- Boss level → `AVG(combat_level)` of users active in this guild within 7 days
- `crd admin stats` → active players = rows with `last_active >= now() - 7d`

---

#### TABLE: `raid_logs`
*Immutable PvE battle results.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | BIGSERIAL | PRIMARY KEY | |
| `discord_id` | VARCHAR(20) | NOT NULL | No FK — preserved if player deleted |
| `battle_type` | VARCHAR(10) | NOT NULL | raid (more types future) |
| `enemy_name` | VARCHAR(100) | NOT NULL | |
| `enemy_tier` | VARCHAR(10) | NOT NULL | regular/elite/boss |
| `result` | VARCHAR(5) | NOT NULL | win / loss |
| `exp_earned` | INTEGER | NOT NULL DEFAULT 0 | |
| `updated_exp` | BIGINT | NOT NULL | New total combat_exp after battle |
| `belief_shards_dropped` | SMALLINT | NOT NULL DEFAULT 0 | |
| `updated_belief_shards` | INTEGER | NOT NULL | New total after drop |
| `credux_earned` | INTEGER | NOT NULL DEFAULT 0 | |
| `updated_credux` | BIGINT | NOT NULL | New total after earn |
| `chest_dropped` | VARCHAR(30) | NULLABLE | "Silver Chest" / "Gold Chest" / null |
| `timestamp` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Indexes:**
- INDEX on `discord_id`
- INDEX on `(discord_id, timestamp DESC)`

---

#### TABLE: `pvp_logs`
*Immutable PvP duel results.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | BIGSERIAL | PRIMARY KEY | |
| `challenger_id` | VARCHAR(20) | NOT NULL | |
| `opponent_id` | VARCHAR(20) | NOT NULL | |
| `winner_id` | VARCHAR(20) | NOT NULL | |
| `challenger_damage` | INTEGER | NOT NULL | Total damage dealt |
| `opponent_damage` | INTEGER | NOT NULL | Total damage dealt |
| `timestamp` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Indexes:**
- INDEX on `challenger_id`
- INDEX on `opponent_id`

---

#### TABLE: `game_logs`
*Immutable economy audit trail. All non-combat currency movements.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | BIGSERIAL | PRIMARY KEY | |
| `discord_id` | VARCHAR(20) | NOT NULL | No FK — preserved if player deleted |
| `action` | VARCHAR(30) | NOT NULL | Bestow / Enhance / Daily / Deity Pull / Deity Enhance / Silver Chest / Gold Chest / Boss Treasure Chest / Boss Golden Chest / Supreme Chest / Sacred Relic / Supreme Relic / Sell Weapon |
| `item_type` | VARCHAR(30) | NULLABLE | Which chest / relic / essence tier moved (disambiguates Daily) |
| `previous_credux` | BIGINT | NULLABLE | |
| `updated_credux` | BIGINT | NULLABLE | |
| `previous_belief_shards` | INTEGER | NULLABLE | |
| `updated_belief_shards` | INTEGER | NULLABLE | |
| `previous_chest_count` | INTEGER | NULLABLE | DEFAULT NULL |
| `updated_chest_count` | INTEGER | NULLABLE | DEFAULT NULL |
| `previous_relic_count` | INTEGER | NULLABLE | DEFAULT NULL |
| `updated_relic_count` | INTEGER | NULLABLE | DEFAULT NULL |
| `previous_essence_count` | INTEGER | NULLABLE | Essence gained (pull) / spent (deity enhance) |
| `updated_essence_count` | INTEGER | NULLABLE | |
| `timestamp` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Action → Non-null columns:**
| Action | Credux | Belief Shards | Chest | Relic | Essence |
|---|---|---|---|---|---|
| Bestow | ✅ | null | null | null | null |
| Enhance | ✅ | null | null | null | null |
| Daily | ✅ | ✅ | ✅ (item_type) | null | null |
| Deity Pull | null | ✅ | null | null | ✅ (on dupe) |
| Deity Enhance | null | null | null | null | ✅ |
| Silver/Gold/Boss/Supreme Chest | null | null | ✅ (item_type) | null | null |
| Sacred Relic / Supreme Relic | null | null | null | ✅ (item_type) | null |

**Indexes:**
- INDEX on `discord_id`
- INDEX on `(discord_id, timestamp DESC)`

---

#### TABLE: `casino_logs`
*Immutable casino audit trail.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | BIGSERIAL | PRIMARY KEY | |
| `discord_id` | VARCHAR(20) | NOT NULL | No FK — preserved if player deleted |
| `game` | VARCHAR(20) | NOT NULL | coin_toss/dice_roll/baccarat/blackjack/slot_machine/crash |
| `bet_amount` | BIGINT | NOT NULL | Credux wagered |
| `result` | VARCHAR(5) | NOT NULL | win / loss |
| `payout` | BIGINT | NOT NULL | Credux won or lost |
| `balance_before` | BIGINT | NOT NULL | |
| `balance_after` | BIGINT | NOT NULL | |
| `metadata` | JSONB | NULLABLE | Game-specific data (crash multiplier, card hands, etc.) |
| `timestamp` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Indexes:**
- INDEX on `discord_id`
- INDEX on `(discord_id, timestamp DESC)`

---

#### TABLE: `dev_logs`
*Immutable dev action audit trail.*

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | BIGSERIAL | PRIMARY KEY | |
| `dev_id` | VARCHAR(20) | NOT NULL | Dev Discord ID |
| `action_type` | VARCHAR(30) | NOT NULL | give_credux/give_beliefshards/give_chest/give_relic/ban/unban/reset/enhance_weapon/enhance_deity |
| `target_discord_id` | VARCHAR(20) | NOT NULL | Affected player |
| `amount_or_detail` | VARCHAR(200) | NULLABLE | Amount, item, or level detail |
| `pre_reset_snapshot` | JSONB | NULLABLE | Full state before reset (reset action only) |
| `timestamp` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

---

### 2.3 Relationships

| Relationship | Type | Description |
|---|---|---|
| `users` → `users_bag` | 1:1 | One bag per user |
| `users` → `user_character` | 1:1 | One character per user |
| `users` → `user_weapons` | 1:M | One user owns many weapons |
| `users` → `user_deities` | 1:M | One user owns many deities |
| `user_deities` → `user_character` | 1:1 | active_deity_id → user_deities.user_deity_id |
| `users` → `pity_counters` | 1:1 | One pity counter per user |
| `users` → `daily_quests` | 1:M | Up to 3 quests per day |
| `users` → `user_guild_activity` | 1:M | One activity row per guild the user acts in |
| `user_weapons` → `weapon_roster` | M:1 | Many owned weapons reference one roster entry |
| `user_deities` → `deity_roster` | M:1 | Many owned deities reference one roster entry |
| `active_battles` → `mob_roster` | M:1 | Battle references mob/boss data |
| `boss_state` → `mob_roster` | M:1 | Boss references mob roster |
| `boss_attack_log` → (no FK) | — | Scoped by boss_spawn_id; history preserved across respawns |
| `users` → `boss_attack_log` | 1:M | One user attacks many boss spawns |
| `users` → `active_battles` | 1:1 | One active battle at a time |
| `guild_id` → `server_config` | 1:1 | One config per server |
| `guild_id` → `boss_state` | 1:1 | One active boss per server |

---

## 3. PASSIVE REGISTRY PATTERN

All weapon passives, deity blessings, and mob skills are handled through a single registry file on the backend. The DB stores the key; the code stores the logic. **The complete, authoritative registry — every key, its exact behavior, round-vs-attack timing, and effect tag — is specified in Master §35.** This section shows only the pattern.

```javascript
// /engine/passiveRegistry.js

const PASSIVE_REGISTRY = {

  // SENTINEL — weapons/mobs with no passive/skill point here
  "none": () => {},

  // WEAPON PASSIVES
  "freyrs_arrow": (bs) => {
    if (Math.random() < 0.50) {
      bs.bonusDamage += bs.playerATK * 1.00
      bs.log.push("✨ Freyr's Arrow procs! Auto-fire 100% ATK damage!")
    }
  },

  // DEITY BLESSING — uses ROUND counter (bs.currentTurn)
  "mandarangan_war_frenzy": (bs) => {
    // ATK +10% per round, capped +30% (rounds 1–3)
    const stacks = Math.min(bs.currentTurn, 3)
    bs.playerATK *= (1 + 0.10 * stacks)
  },

  // MOB SKILL — uses ROUND counter
  "manananggal_viscera_drain": (bs) => {
    if (bs.currentTurn % 3 === 0) {
      const drain = Math.floor(bs.playerMaxHP * 0.15)
      bs.playerHP -= drain; bs.enemyHP += drain
      bs.log.push("🩸 Viscera Drain! 15% max HP drained.")
    }
  },

  // EFFECT on the ROUND counter, gated by immunity tags
  "skadi_winters_hunt": (bs) => {
    if (bs.currentTurn % 3 === 0) {
      bs.bonusDamage += bs.playerATK * 0.40
      if (!bs.enemyImmune("freeze")) bs.applyDebuff("freeze", 1)   // 1-turn CC
    }
  }
}

module.exports = PASSIVE_REGISTRY
```

**Battle engine call per turn:**
```javascript
// "none" resolves to a no-op, so no key is ever unhandled
PASSIVE_REGISTRY[weapon.passive_key]?.(bs)
PASSIVE_REGISTRY[deity.blessing_key]?.(bs)     // only the ACTIVE deity
PASSIVE_REGISTRY[mob.skill_key]?.(bs)
// special_flags (first_strike, multi_attack) and immunity_tags are handled by the engine, not the registry
```

**Adding a new mythology later:**
1. INSERT rows into `deity_roster`, `weapon_roster`, `mob_roster` in DB
2. Add new entries to `PASSIVE_REGISTRY` for new passives/blessings/skills (and register any new effect tags)
3. Zero changes to battle engine, zero changes to queries, zero schema changes

---

## 4. API & DATA FLOW

### MIDDLEWARE (Every Command)
```
1. Query users WHERE discord_id = $1 → check is_banned
2. If banned → silent fail or plain text error
3. Check registration → redirect if not registered
4. Check character → redirect if no character (RPG commands only)
5. Check bot_channel_id → if set and used elsewhere, one-line notice + ignore
6. Check cooldown → 10 seconds universal
7. UPSERT user_guild_activity (discord_id, guild_id, last_active = now())
```

> `crd admin *` additionally requires the Discord **Manage Server** permission.

### ECONOMY

**`crd cred`**
- Read: `users_bag` WHERE discord_id = $1
- Output: Credux + Belief Shards + Relic counts embed

**`crd bestow @user [amount]`**
- Validate: amount is a positive integer; receiver ≠ sender; receiver is registered with a character and not banned; sender has enough Credux
- Lazy reset: if receiver `last_bestow_received < today (PHT)` → set `bestow_received_today = 0`
- Validate receiver cap: `bestow_received_today + amount ≤ 1,000,000` (else reject whole tx, report remaining capacity)
- Write (transaction):
  - `users_bag.credux -= amount` (sender)
  - `users_bag.credux += amount` (receiver)
  - `users.bestow_received_today += amount`, `last_bestow_received = today` (receiver)
  - INSERT `game_logs` (action = "Bestow")
- Output: Embed — sender, receiver, amount only

### GACHA

**`crd summon [1/5/10]`** (alias `crd s`)
- Requires a character. All-or-nothing: needs full N×100 shards or errors.
- Read: `pity_counters`, `users_bag.belief_shards`
- Per roll: tier roll → if pity_count hits 500 force Legendary → `SELECT FROM deity_roster WHERE tier = $tier ORDER BY RANDOM() LIMIT 1`
- Pity: reset to 0 on ANY Legendary or Supreme (natural or forced); else +1
- Write (transaction):
  - `users_bag.belief_shards -= cost`
  - For each pulled deity: if NOT owned → INSERT `user_deities` (auto-set active_deity_id if player has none); if owned → `+1 <tier>_essence` in `users_bag`
  - UPDATE `pity_counters`
  - believer_exp += 10/pull (respecting 5,000/day cap)
  - INSERT `game_logs` (action = "Deity Pull"; essence cols on dupes)
- Output: Animation + results embed

**`crd deity equip [deity name]`**
- Validate: player owns the deity (by unique name → deity_id → user_deities row)
- UPDATE `user_character.active_deity_id` = that `user_deity_id`

**`crd deity enhance [deity name]`**
- Validate: owns it, not at enhancement 11, enough `<tier>_essence` for the next level (deityEnhancement.js cost table)
- Write (transaction): spend essence → `user_deities SET enhancement+1`, recompute curr stats (floor × deityBoostTable) → INSERT `game_logs` (action = "Deity Enhance") → believer_exp (capped)

### WEAPONS

**`crd open [chest] [amount]`**
- Per chest: `SELECT FROM weapon_roster WHERE tier = $rolled_tier ORDER BY RANDOM() LIMIT 1`
- Generate weapon_id (UUID 8-char), roll base stats within tier range
- Write (transaction):
  - `users_bag.[chest_type] -= amount`
  - INSERT `user_weapons` (curr stats = base stats at enhancement 1)
  - INSERT `game_logs` (action = "[Chest Type]")
- Output: Chest opening animation + weapon results

**`crd enhance [weapon_id]`**
- Read: `user_weapons WHERE weapon_id = $1` (globally unique — no @user needed)
- Validate: player owns it, not at enhancement 11, enough Credux
- Roll success against hardcoded success rate table
- On success: compute new curr stats via `floor(base × weaponBoostTable[enhancement+1])`
- Write (transaction):
  - `users_bag.credux -= cost` (spent on success AND failure)
  - On success: `user_weapons SET enhancement = enhancement+1, curr_atk/hp/def = $new`
  - INSERT `game_logs` (action = "Enhance")
  - believer_exp += 50 (capped); UPDATE `daily_quests` — both success and failure count toward "enhance X times" / "spend Credux on enhancement"

**`crd lock [weapon_id]` / `crd unlock [weapon_id]`**
- Validate: player owns it
- UPDATE `user_weapons SET is_locked = TRUE|FALSE WHERE weapon_id = $1 AND discord_id = $2`

**`crd sell [weapon_id | tier | all]`** (permanent delete)
- Resolve target rows: exclude `is_locked = TRUE` and the equipped weapon; for `[tier]` join `weapon_roster` on tier; for `all` exclude tiers Legendary + Supreme; for `[weapon_id]` block if equipped → "Unequip it first."
- Compute count + payout from fixed prices (Common 100 / Rare 1,000 / Mythic 5,000 / Legendary 100,000 / Supreme 1,000,000)
- Plain-text confirm (NOT embed) with Confirm/Cancel: *"…sell [count] weapons for [total] Credux? This permanently deletes them."*
- On Confirm (single transaction, recompute set first):
  - `DELETE FROM user_weapons …` (the resolved set)
  - `users_bag.credux += total`
  - INSERT `game_logs` (action = "Sell Weapon", item_type = tier or "all", previous/updated credux)
- On Cancel: no-op

### BATTLE

**`crd raid`**
- Read: `user_character` JOIN `user_weapons` JOIN active `user_deities`
- Roll 75/25 → `SELECT FROM mob_roster WHERE mob_type = $type ORDER BY RANDOM() LIMIT 1`
- Compute mob stats: base + (per_level × clamp(mob_level,1,55)); roll first attack (50/50)
- INSERT `active_battles`
- Battle loop: PASSIVE_REGISTRY triggers (active deity only); increment `current_turn` per round (single clock — "every Nth" effects use it; "first hit" effects use a first-action flag); death checked after each hit/DOT; CC + stat debuffs last 1 turn, Bleed/Burn DOTs tick 2 turns; from round 30 both lose 10% max HP/round; hard stop at round 50; UPDATE `active_battles` each round, edit message every 2–3 rounds
- On completion:
  - DELETE `active_battles`
  - INSERT `raid_logs`
  - UPDATE `users_bag` (Credux, Belief Shards, chest)
  - UPDATE `user_character` (combat_exp, believer_exp [capped], raids_won/lost)
  - UPDATE `daily_quests` progress

**`crd duel @user`** (in-memory — NOT persisted to active_battles)
- Validate: opponent registered + has character + not self/bot. **Unified busy-check** for BOTH players: free only if NOT in the in-process duel busy-set AND has NO `active_battles` row (raids/bosses must also block dueling, and vice-versa). Busy-set is process-local — on restart, in-flight duels are abandoned (acceptable; nothing persisted).
- Both players' stats loaded same as raid; same engine, same round/drain/cap rules
- Instant-kill passive (Knuckle Charm) is disabled in duels; all other effects apply
- Friendly: 0 combat EXP. On completion:
  - INSERT `pvp_logs`
  - UPDATE `user_character` pvp_wins/losses
  - UPDATE `daily_quests` (duel_wins, duel_challenges — accepted duels vs distinct opponents only)

### BOSS

**Boss Attack Flow** (persisted in `active_battles`, battle_type = 'boss')
- Validate: boss active + not expired; `users.last_boss_attack_date` ≠ today (global cross-server lock)
- Read: `boss_state` (incl. spawn_id), boss CRIT from `mob_roster`, player full stats
- INSERT `active_battles` (mob_id = boss); fight runs same as raid — player chips the shared pool until the player dies or round-50/drain ends it (player cannot solo-kill the boss). Hydra's regen heals the **local instance only**; commit only NET damage. Enemy-HP-% effects read the live shared pool %.
- Each turn, re-check `boss_state`: if it's already `dead`/`escaped` (someone else killed it, or the 1-hr timer fired), **stop and resolve** this instance (commit net damage if the pool is still alive, else discard) and DELETE the `active_battles` row.
- Write (transaction):
  - `boss_state.current_hp -= net_damage`
  - UPSERT `boss_attack_log` keyed on `(boss_spawn_id, discord_id)` (records participation; total_damage kept for stats only)
  - SET `users.last_boss_attack_date = today`
  - If `current_hp <= 0`: status = 'dead'; distribute **participation rewards to every attacker of this spawn** (Credux + EXP + Boss Treasure Chest + Belief Shards) — **no top-damage reward**
  - DELETE `active_battles`; INSERT `raid_logs` (enemy_tier = 'boss')

### DAILY & QUESTS

**`crd daily`**
- Validate via `last_daily_claim_date`: == today → already claimed; == yesterday → streak+1; earlier → reset monthly_streak to 1 (overall_streak still +1). Cycle loops 1→30→1.
- Look up reward from hardcoded daily table by monthly_streak
- Write (transaction):
  - UPDATE `users` streak fields + `last_daily_claim_date = today`
  - UPDATE `users_bag` (Credux, Belief Shards, chest)
  - UPDATE `user_character` believer_exp += 200 (capped at 5,000/day)
  - INSERT `game_logs` (action = "Daily", item_type = chest granted)

> Quest rewards auto-credit the instant `current_count` reaches `target_count` (sets completed = true, grants reward, logs it). `crd quests` only displays.

### PROFILE

**`crd profile`**
- Read: `user_character` JOIN `user_weapons` JOIN `user_deities` JOIN `deity_roster` JOIN `users_bag`
- Fetch Discord avatar via Discord API
- Canvas render → PNG → send

### DEV COMMANDS

**`crd dev enhanceweapon [weapon_id] [+level]`**
- Validate: dev_id in DEV_IDS
- UPDATE `user_weapons` enhancement = target+1, recalculate curr stats
- INSERT `dev_logs`

**`crd dev enhancedeity @user [deity_name] [+level]`**
- Validate: dev_id in DEV_IDS
- UPDATE `user_deities` enhancement = target+1, recalculate curr stats (floor × deityBoostTable); bypasses essence cost
- INSERT `dev_logs`

---

## 5. HARDCODED CONSTANTS (Backend Config Files)

```
/config
  /enhancement.js         — Weapon: Credux cost table, success rate table, BOOST TABLE (lookup, not formula)
  /deityEnhancement.js    — Deity: ESSENCE cost table by tier + deity BOOST TABLE (uniform +10%/lvl)
  /expTable.js            — Combat level EXP thresholds (Levels 1–50)
  /believerExpTable.js    — 3,000 EXP flat per level + 5,000/day reputation cap + per-source EXP values
  /dailyRewards.js        — Credux, Belief Shards, Chest per day (Days 1–30, fixed 30-day cycle)
  /dropRates.js           — Deity gacha tier rates, chest weapon tier rates, mob spawn rates, weapon STAT-BANDING algorithm
  /questPool.js           — Quest types, count ranges, reward buckets, anti-farm (distinct-opponent) rules
  /battleConfig.js        — Round/attack counter rules, CRIT caps (40% class / 45% total), sudden-death drain (round 30, 10%/round), round-50 cap, immunity-tag vocabulary
  /casino.js              — Per-game odds/RTP, payouts, min bet 1 / max bet 150,000
  /starter.js             — Starter weapon (Initiate's Blade) + creation grant (1,000 shards, 10 silver chests)
  /devIds.js              — DEV_IDS from .env
```

**What stays hardcoded vs what moves to DB:**

| Data | Location | Reason |
|---|---|---|
| Deity base stats, blessings, lore | `deity_roster` DB table | Flexible — insert for new mythologies |
| Weapon names, passives, lore | `weapon_roster` DB table | Flexible — insert for new weapons |
| Mob stats, skills, immunities | `mob_roster` DB table | Flexible — insert for new mobs (incl. special_flags, lore, image) |
| Passive/blessing/skill LOGIC | `passiveRegistry.js` | Code — cannot store executable logic in DB (full spec in Master §35) |
| Weapon enhancement costs + boost table | `enhancement.js` | Static game balance |
| Deity essence costs + boost table | `deityEnhancement.js` | Static game balance |
| EXP thresholds + reputation cap | `expTable.js` / `believerExpTable.js` | Static |
| Gacha rates + weapon stat banding | `dropRates.js` | Static game balance |
| Battle caps / drain / immunity vocab | `battleConfig.js` | Static game balance |
| Daily reward table | `dailyRewards.js` | Static — rarely changes |

---

## 6. NEXT STEPS CHECKLIST

### Phase 1 — Project Setup
- [ ] Initialize Node.js project with discord.js v14
- [ ] Set up PostgreSQL instance
- [ ] Create `.env`: `BOT_TOKEN`, `DATABASE_URL`, `DEV_IDS`
- [ ] Set up connection pool (node-postgres `pg`)
- [ ] Run schema migrations (credd_schema_v4.sql — all tables in dependency order, incl. user_guild_activity)
- [ ] Seed roster tables: `deity_roster`, `weapon_roster`, `mob_roster` (incl. starter weapon, "none" sentinels, special_flags, lore, image_filename)
- [ ] Build `passiveRegistry.js` from Master §35 (every key incl. "none" no-op) + register effect tags
- [ ] Set up command handler with category routing
- [ ] Set up middleware pipeline (ban → registration → character → bot-channel → cooldown → activity upsert)
- [ ] Set up midnight PHT reset scheduler (node-cron): streaks, quest rollover, bestow + reputation daily counters
- [ ] Startup cleanup: DELETE stale `active_battles`; plus a **periodic reaper** (every 1 min) that deletes `active_battles` with `started_at` older than ~5–10 min and unlocks the player (prevents a crashed battle locking the player out via the UNIQUE(discord_id) row)
- [ ] Set up error handler (plain text, no embed on errors)

### Phase 2 — Registration & Character Creation
- [ ] `crd register` — welcome embed, story text, single "I Understand" button
- [ ] On confirm: INSERT `users`, INSERT `users_bag`, INSERT `pity_counters`
- [ ] `crd create character` — class selection embed, 5 buttons
- [ ] On class confirm: INSERT `user_character`; grant 1,000 Belief Shards + 10 Silver Chests; generate starter weapon row (Initiate's Blade) and set equipped_weapon_id (NOT granted at registration)
- [ ] Unregistered guard middleware
- [ ] No-character guard middleware (also gates `crd summon`)

### Phase 3 — Economy
- [ ] `crd cred` — balance embed
- [ ] `crd bestow` — transfer with daily cap + game_logs entry
- [ ] `crd dev givecredux/givebeliefshards/givechest/giverelic`
- [ ] `crd dev ban/unban/resetplayer`

### Phase 4 — Gacha System
- [ ] Two-step roll (tier → specific deity via deity_roster query)
- [ ] Pity counter logic (per roll, reset on any Legendary OR Supreme)
- [ ] Owned → +1 tier essence; not owned → INSERT user_deities (+ auto-equip if none active)
- [ ] `crd summon / summon 5 / summon 10` (alias `crd s`, character-gated, all-or-nothing)
- [ ] Gacha animation (edit-based PNG frame swap)
- [ ] `crd deity collection` — paginated by mythology (shows owned + tier essence balances)
- [ ] `crd deity info` — Canvas PNG, INNER JOIN deity_roster for lore
- [ ] `crd deity equip [name]` — set active_deity_id
- [ ] `crd deity enhance [name]` — essence cost check, UPDATE curr stats (floor × boost table)
- [ ] `crd open sr / supr` — relic opening animations

### Phase 5 — Weapon & Inventory System
- [ ] `crd bag` — overview embed, relic counts in footer
- [ ] `crd bag chests` — chest counts + open shortcuts
- [ ] `crd bag weapons` — paginated, sorted by tier, filter dropdowns
- [ ] `crd open [chest]` — tier roll via weapon_roster, UUID generation, stat roll
- [ ] `crd equip [weapon_id]` — UPDATE user_character.equipped_weapon_id
- [ ] `crd weapon info [weapon_id]` — Canvas PNG, INNER JOIN weapon_roster for lore
- [ ] `crd enhance [weapon_id]` — success roll, UPDATE curr stats (floor × boost table), INSERT game_logs, quest credit on success AND fail
- [ ] `crd lock [weapon_id]` / `crd unlock [weapon_id]` — toggle `is_locked`; 🔒 badge in bag list
- [ ] `crd sell [weapon_id | tier | all]` — plain-text Confirm/Cancel with permanent-delete warning; excludes locked + equipped; `all` skips Legendary/Supreme; credit Credux; INSERT game_logs (Sell Weapon)
- [ ] `crd dev enhanceweapon/enhancedeity`

### Phase 6 — Passive Registry & Battle Engine
- [ ] Wire PASSIVE_REGISTRY (built in Phase 1 from Master §35) into the engine; verify every roster key resolves
- [ ] Build stat calculator (class + weapon curr + deity curr; CRIT cap 40% class / 45% total)
- [ ] Build damage formula engine (enemy crit ×2.0)
- [ ] Build class passive engine (Bleed, Stun, Overcharge, Damage Reduction, Pierce)
- [ ] Build debuff tracker + immunity-tag checks (battleConfig.js vocabulary) + special_flags (first_strike, multi_attack)
- [ ] Round counter + per-actor attack counters; first attack roll (50/50)
- [ ] Sudden-death drain (round 30, 10%/round) + round-50 hard cap + death-check after each hit/DOT
- [ ] `crd raid` — spawn roll, battle loop, embed updates, battle log
- [ ] `crd duel @user` — challenge flow, in-memory (busy-set lock, instakill disabled)

### Phase 7 — Boss System
- [ ] Boss spawn scheduler (15min after death/escape; first spawn after first character; skip empty servers)
- [ ] Boss escape timer (1hr)
- [ ] Boss level calculation (server avg combat_level via user_guild_activity INNER JOIN user_character, 7-day window + random; skip spawn if no active players; new spawn_id each spawn)
- [ ] Boss HP shared pool (boss_state.current_hp); persisted fight via active_battles (battle_type='boss'); Hydra regen on local instance, commit NET damage
- [ ] Individual fight flow (player chips HP until death / drain / round-50); per-turn re-check for dead/escaped boss → resolve & close orphaned instance
- [ ] Global daily lock via users.last_boss_attack_date
- [ ] Boss death detection + **participation reward distribution to every attacker of the spawn** (no top-damage reward)
- [ ] Boss announcement: boss_announcement_channel_id → fallback announcement_channel_id

### Phase 8 — Daily & Quests
- [ ] `crd daily` — streak via last_daily_claim_date, hardcoded reward table, INSERT game_logs
- [ ] Midnight PHT reset (streak check, quest rollover w/ reward buckets, new 3 quests, reset reputation/bestow daily counters)
- [ ] Quest progress hooks on all triggering commands (auto-credit on completion; distinct-opponent rule for duels)
- [ ] `crd quests` — progress embed (display only)

### Phase 9 — Profile & Canvas
- [ ] Set up node-canvas
- [ ] `crd profile/stats` — full Canvas PNG
- [ ] `crd deity info` — Canvas PNG card
- [ ] `crd weapon info` — Canvas PNG card
- [ ] Asset folders: /assets/{deities,weapons,classes,essence}, /assets/items/{,chests}, /assets/animations/{gacha,chests,relics} (see Roster & Asset Conventions). No /mobs folder — mobs have no art.

### Phase 10 — Casino
- [ ] `crd coin toss` — 50/50, ~1.95× payout
- [ ] `crd dice roll` — odd/even, ~1.95×
- [ ] `crd baccarat` — banker/player (5% banker commission)
- [ ] `crd blackjack` — 6-deck, dealer stands 17, BJ pays 3:2
- [ ] `crd slot machine` — paytable, ~90% RTP
- [ ] `crd crash` — multiplier, ~3% edge
- [ ] All games: min bet 1 / max bet 150,000; INSERT `casino_logs`

### Phase 11 — Admin & Help
- [ ] `crd admin setprefix/setannouncementchannel/setbosschannel/setbotchannel/stats` (require Manage Server)
- [ ] bot_channel restriction notice behavior
- [ ] `crd help` — categorized, dev commands hidden

### Phase 12 — Polish & Deploy
- [ ] Migrate assets to Cloudflare R2
- [ ] Set up Tebex (post-launch)
- [ ] Load testing (concurrent battles, boss pool race conditions)
- [ ] Production deployment

---

*End of Technical Blueprint v4*
*Companion: CREDD_Master_Export_v4.md (game mechanics source of truth, incl. §35 Passive Registry & Backend Constants) and credd_schema_v4.sql (runnable DDL)*
