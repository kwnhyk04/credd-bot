# Genesis Update — Phase 0 Discovery Notes (2026-07-20)

Codebase + schema inspection performed before any change. All names below verified in-repo; nothing invented.

## Command architecture

- Dual surface: prefix `crd` + slash mirror routing to one handler map.
- Prefix dispatch: `src/handlers/commandHandler.js` — `IMPLEMENTED` map (:67-122), `COMMAND_MAP` requiresCharacter flags (:125-178). Aliases: `src/config/aliases.js`. Subcommands are `args[0]` inside each command module.
- Slash dispatch: `src/events/interactionCreate.js` + `src/commands/slashDefinitions.js` (`assemble()` reconstructs canonical tokens). Context abstraction: `src/utils/commandContext.js`.
- `crd use` already exists (`src/commands/rpg/use.js`, registered commandHandler.js:110) — currently handles only `use skin <code>`. New item usage = new branch, no new wiring.
- Base `crd shop` is explicitly reserved for future content (`src/commands/rpg/shop.js:21-25`); `crd shop supporter` is the only live path — CRD Shop takes over base cleanly.
- Component interactions: namespaced customIds (`create:*`) dispatched in `src/handlers/interactionHandler.js` + `INTERACTION_COMMANDS`.

## Reward system / quest-reward crediting pattern (template)

- `src/utils/questProgress.js`: caller owns `BEGIN/COMMIT` (from `pool.connect()`), crediting functions take a `client`. Documented lock order: **users_bag → user_character → quests** (questProgress.js:26-28).
- Credit = single `UPDATE users_bag SET credux = credux + $, ... RETURNING`.
- Idempotency patterns: completion-flag guard (`UPDATE ... SET completed=TRUE WHERE completed=FALSE RETURNING`) and insert-guard (`INSERT ... ON CONFLICT ... DO UPDATE ... WHERE claimed=FALSE RETURNING`, weekly_grand).
- Audit: one `game_logs` row per currency changed.
- Fullest transactional example: `src/commands/rpg/raid.js:112-220`.

## Level systems

- Combat: `user_character.combat_level` (smallint, stored) + `combat_exp` (within-level). Curve `src/config/combatExp.js` (MAX_COMBAT_LEVEL=50). Apply/persist `src/utils/awardCombatExp.js` (FOR UPDATE; returns `{levelsGained, previousLevel, newLevel, leveledUp}`) + `awardCombatExpMany`. Callers: raid.js:155, autoRaid.js:344, bossSystem.js:1440, duel. Level-up currently yields a display notice only — no rewards.
- Believer: `user_character.believer_level` + `believer_exp`. TWO gain paths: `src/utils/awardBelieverExp.js` (owns txn; locks character only; 3 exp/command via `awardCommandBelieverExp` after every command) and `src/engine/summonEngine.js` `awardReputation` (:301-331, runs in caller's txn; summon + relic-open paths). Believer level-up currently grants titles only.

## Inventory system

- Currency + stackables = integer columns on `users_bag`: `credux`, `belief_shards`, `valor_medals`, `sacred_relics`, `supreme_relics`, `silver_chest`, `gold_chest`, `boss_treasure_chest`, `boss_golden_chest`, `supreme_chest`, essences, `lesser_rune_bag`, `greater_rune_bag`, `divine_rune_bag`, `lifetime_credux_earned` (production-consolidated-schema.sql:543-563).
- Instanced gear: `user_weapons`, `user_armors`, `user_runes` (own rows, 8-char ids).
- Item emoji registry: `assets/data/game_items.txt` (`Name | 'emoji_name' | 'emoji_id'`) via `src/utils/emojis.js`. Stackable definitions hardcoded: `src/engine/bagViews.js` (CHESTS/RELICS arrays), `src/config/dropRates.js`.

## Current IDs (as requested)

| Item | User-facing ID / code | Bag column | Notes |
|---|---|---|---|
| Sacred Relic | `sr` | `sacred_relics` | RELICS array, bagViews.js:48-51 |
| Supreme Relic | `supr` | `supreme_relics` | same |
| Genesis Chest | — (none) | — (none) | **emoji only** (`genesis_chest`, `genesis_open` in game_items.txt); zero code wiring |
| Diamond Chest | — (none) | — (none) | **emoji only** (`diamond_chest`, `diamond_open`); zero code wiring |
| Change Class item | — (none) | — (none) | emoji `change_class` pre-provisioned in game_items.txt (uncommitted); no column/handler |

Chest codes in use: `sc`, `gc`, `btc`, `bgtc`, `supc`. Rune bags: `lb`, `gb`, `db`.

## PvP Shop (clone target for CRD Shop)

- `src/commands/rpg/pvpShop.js`: static Components-V2 `ContainerBuilder` listing (no pagination, no buttons) + `crd pvp buy <id> [qty]`. Atomic purchase: BEGIN → `FOR UPDATE` users_bag → `FOR UPDATE` pvp_shop_purchases → cap/afford checks → upsert `ON CONFLICT ... DO UPDATE ... WHERE qty+EXCLUDED.qty <= cap RETURNING` (concurrent-bypass guard) → single deduct+grant UPDATE → COMMIT; catch → ROLLBACK ("nothing was spent").
- Limit tracking: DB table `pvp_shop_purchases (discord_id, season_id, item_key, qty)` — the precedent for period-keyed `crd_shop_purchases`.

## CRD Bag

- `src/commands/rpg/bag.js` (dispatch :326-332) + `src/engine/bagViews.js`. Chests view = CHESTS array + RELICS array; column↔code map in `getChestCounts` (:202-220). Categories are code-side arrays, not DB rows → relic "move" = code change, zero data migration.

## Character class system

- `src/config/classes.js`: CLASS_NAMES ['Swordsman','Fighter','Mage','Knight','Archer'] (must match `user_character.class` CHECK). No class-change logic exists anywhere; class written only at creation (create.js:269).
- Create Character: `src/commands/rpg/create.js` — ContainerBuilder payloads (`classSelectPayload`, `classSelectRow`, `classPreviewPayload`, `previewRow`), handlers (`handleClassSelect`/`handleBack`/`handleConfirm`), customIds `create:*`, BRAND 0x9b59b6. **No gender selection.**
- Stats are runtime-derived from class+level (`src/engine/statAssembly.js` `assemblePlayerStats`); no stored stat columns → class change auto-recomputes stats.
- Equipment: NO class-based restrictions (equip checks ownership only) → spec's "incompatible equipment" rule is a documented no-op.

## Avatar renderer / skins / assets

- Avatar system: `src/engine/avatarSystem.js` + tables `avatar_catalog` (avatar_key, class_name, gender male|female, style, token_cost, asset_path), `user_avatars`, `equipped_avatars` (scripts/avatar-system-schema.sql). Styles: cyber(9)/anime(12)/webtoon(15) supporter tokens + grant-only founder/tester. **No 'genesis' style yet.** Founder avatars are genderless per user.
- Existing path shape: `skins/avatars/{gender}/{class}/{class}_{style}.png` (`canonicalAvatarAssetPath` avatarSystem.js:100). Genesis spec shape differs: `skins/avatars/genesis/{gender}/genesis_{class}_{gender}.png`.
- **Gender source: no `user_character.gender` column exists.** Gender lives only on avatar_catalog rows. (User decision: derive from equipped avatar row.)
- Renderer: `src/engine/renderStats.js` → `src/engine/avatarImageLoader.js` (candidate expansion; placeholder + performanceLog on missing asset — no crash).
- Asset loading: `src/utils/assets.js` `assetPath(rel)` → `ASSET_BASE_URL` (R2 public) remote, else local `assets/`. Bounded caches: in-memory LRU (256 entries / 40 MB / 30 min TTL), disk (2000 files / 384 MB), negative cache (600 s). R2 writes via `src/utils/r2Client.js`.
- Render cache: `src/utils/canvasCache.js` — content-addressed (hash of render inputs incl. class) → memory → `canvas_cache` DB → R2; `sweepCanvasCache` 14 d. Class change changes inputs → new keys automatically; no global flush needed or possible per-user.

## PvP ranks

- Central config: `src/config/ranked.js` BRACKETS — Mortal 0-999, Champion 1000-2499, Demigod 2500-4999, Ascendant 5000-9999, Divine 10000-∞. `bracketOf()` first-match; ranks derived at read time from `user_character.pvp_rating`/`pvp_peak` (no stored rank ids).
- DB touchpoints: `ranked_reward` table (PK bracket) with CHECK `ranked_reward_bracket_check` enumerating the 5 names (production-consolidated-schema.sql:1320; schema.sql:805). Reward values exist only in the live DB.
- Surfaces: match embeds (ranked.js:213-221), promote/demote shield (:71-85), leaderboard rating category, weekly claim (:286,319), season-end payout by pvp_peak (seasonEngine.js:88), season titles (Divine rotating exclusive via `divineSeasonTitle`, seasonEngine.js:47-49), help.js, dev.js season admin. No rank emoji/icon system (name + tier index only).

## Timezone / reset convention

- **PHT (`Asia/Manila`) everywhere.** SQL idiom `(NOW() AT TIME ZONE 'Asia/Manila')::date`; daily reset cron 00:00 PHT (`src/schedulers/resetScheduler.js`); weekly = `phtWeek()` (ranked.js:114-123, `year*100 + ISO week`, Monday boundary); `hoursUntilMidnightPHT()` (questProgress.js:456-463). CRD Shop periods follow PHT: daily date, ISO week, calendar month.

## Transactions / concurrency patterns

- `pool.connect()` → BEGIN → `SELECT ... FOR UPDATE` (bag first) → work → COMMIT / catch ROLLBACK → finally release.
- Concurrency guards: cap-guarded upserts with RETURNING (pvpShop), conditional decrements (`WHERE col >= n RETURNING`), in-DB TTL locks (`active_ranked_fights` INSERT ON CONFLICT DO UPDATE WHERE expires_at <= NOW()).

## SQL / migration conventions

- `scripts/migrations/YYYYMMDD_<snake_desc>.sql` (precedent: `20260711_add_deity_ascension_progress.sql`). Authoritative schema: `scripts/production-consolidated-schema.sql`. Boot check: `src/db/schemaGuard.js` `verifyRequiredSchema` (index.js:251).

## Test infrastructure

- No framework. Plain Node `assert` selftest scripts in `scripts/` + package.json entries (`selftest:*`, aggregate `selftest:full`). Mock db/client pattern. Battle passives coverage asserted both ways vs `assets/data/passive_registry_keys.md` by `scripts/battle-selftest.js`.

## Genesis weapons spec (specs/genesis_tier_weapons.md)

- 5 weapons ids 78-82, tier 'Genesis' (fits `weapon_roster.tier` varchar(10)), types Sword/Bow/Staff/Gloves/Greatsword, base 1600 ATK / 20% crit / +50% crit dmg, passive keys kiri/moira/sophia/atlas/titan. "Brawler" in the overview table maps to the bot's Fighter class. items.txt needs 5 weapon emoji entries (IDs pending user emoji upload).
- `weapon_roster` columns: weapon_roster_id, name, type, tier, mythology, passive_key, passive_name, passive_description, lore, image_filename, is_available.

## Assumptions

1. "Same embed design as the PvP Shop" = its ContainerBuilder listing + `buy` subcommand style (PvP Shop has no pagination/buttons to clone).
2. Sacred/Supreme Relic "existing IDs" = their bag codes `sr` / `supr`.
3. `crd use sr|supr` effect = the existing relic-open (summon) flow from `open.js` `openRelic`.
4. Equipment incompatibility on class change = no-op (no class restrictions exist; equipment preserved untouched).
5. "Invalidate only the affected cache" is satisfied structurally by the content-addressed canvasCache (class is a render input).
6. Level rewards start at level 2 (user decision overriding spec's "from Level 1"); compensation matches.
7. Believer rewards cap at level 50; levels >50 grant nothing.
8. Weekly limit = PHT ISO week (Monday); monthly = PHT calendar month; daily = PHT date. Documented as the project convention (spec §5 requirement met — convention exists, no UTC fallback needed).
9. Genesis weapon emoji IDs are placeholders until emojis are uploaded to Discord.
10. Genesis avatar images assumed uploaded to R2 at the spec paths; loader fallback + warn covers any gap.
11. Tester-style avatars treated like founder (grant-only remap on class change) — flag for confirmation.
12. Genesis Chest gets no CRD Shop price (spec); it opens to one random Genesis weapon (user decision). Diamond Chest = 50% Mythic / 50% Legendary gear (user decision).
