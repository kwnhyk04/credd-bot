# CREDD Current Masterfile

<!-- Updated: 2026-07-30 | Patch: Implement RPG balance and passive overhaul | Commit: 5e76cfc -->
<!-- Follow-up updated: 2026-07-30 | Patch: Complete weapon and armor passive log audit | Commit: pending -->

Last consolidated from codebase: 2026-07-30

This file is the current source of truth for the live code in this repository. It consolidates the older `CREDD_Master_Export_v4.2.md` base and `CREDD_Master_Export_v5.md` overlay, but resolves conflicts against the actual implementation in `src/`, `scripts/`, and current config files.

## Bot overview

Credd is a Discord RPG bot for The Last Believer. It is prefix-first with slash-command support for the core public command set.

- Runtime: Node.js, discord.js v14, PostgreSQL.
- Default permanent prefix: `crd`.
- Server admins can configure a custom guild prefix; `crd` remains accepted.
- Entry point: `index.js`.
- Main handlers: `src/handlers/commandHandler.js`, `src/events/interactionCreate.js`, `src/handlers/interactionHandler.js`.
- Render stack: `@napi-rs/canvas` plus `sharp` for optimized/composed image output.
- Scheduling: reset, boss, battle cleanup, season, casino session recovery, and canvas-cache sweeps start from `index.js`.
- Game state is stored in PostgreSQL. Most game mutations use explicit transactions and row locks.

## Core commands

Prefix commands are routed by `src/handlers/commandHandler.js` and aliases in `src/config/aliases.js`. Slash commands are defined in `src/commands/slashDefinitions.js`.

Core slash-backed commands:

- Account/profile: `crd register`, `crd create character`, `crd profile [@user]`, `crd stats`, `crd cred`.
- Inventory/gear: `crd bag [section]`, `crd open <type> [amount]`, `crd equip <id>`, `crd equipment info <id>`, `crd enhance <id>`, `crd lock <id>`, `crd unlock <id>`, `crd sell <id|tier|all>`.
- Gacha/deities: `crd summon [1-30]`, `crd deity collection`, `crd deity info <name>`, `crd deity equip <name>`, `crd deity enhance <name>`.
- Battle: `crd raid`, `crd duel @user [level N]`, `crd boss`.
- Economy: `crd bestow @user <amount>`, `crd daily`, `crd quests`.
- Admin: `crd admin setprefix`, `setbotchannel`, `setannouncementchannel`, `setbosschannel`, `stats`.
- Help: `crd help [category]`.

Implemented prefix-only or help-listed systems:

- `crd auto raid`
- `crd ranked`, `crd ranked claim`
- `crd leaderboards`
- `crd pvp shop`, `crd pvp buy <id> [qty]`
- `crd title`
- `crd rune bag`, `crd runes`
- `crd socket`, `crd unsocket`
- `crd essence shop`
- `crd exchange <lb|gb|db> [qty]`, `crd exchange essence`
- `crd shop`, `crd buy <skin_code>`, `crd skin collection`, `crd use skin <skin_code>`, `crd set all skin default`

Important aliases:

- `cc` -> `create character`
- `s` -> `summon`
- `o` -> `open`
- `r` -> `raid`
- `ar` -> `auto raid`
- `d` -> `duel`
- `b`, `bc`, `bw`, `ba` -> bag views
- `ei` -> `equipment info`
- `rk` -> ranked, `rc` -> ranked claim, `lb` -> leaderboards, `ps` -> pvp shop

Slash syntax uses option names, not free text. For example:

- `/summon count:10`
- `/open type:sc amount:10`

## Character creation flow

Implemented in `src/commands/rpg/create.js`.

1. The player must be registered first.
2. `crd create character` or `/create character` opens a Components V2 class picker.
3. Classes are Swordsman, Fighter, Mage, Knight, Archer, using `src/config/classes.js`.
4. Class preview renders a portrait card when assets/canvas cache are available, otherwise falls back to text.
5. Confirming creates:
   - a `user_weapons` row for Initiate's Blade,
   - a `user_armors` row for Initiate's Garb,
   - a `user_character` row with both equipped,
   - the starter grant in `users_bag`.
6. Creation is guarded against banned users, missing registration, duplicate characters, and missing starter roster rows.

Starter gear:

- Weapon: Initiate's Blade, Common, ATK 15, CRIT 1.0.
- Armor: Initiate's Garb, Common, HP 40, DEF 10.

## Starter grants

Source: `src/config/starter.js`.

Granted once at character creation, not at registration:

- 1,000 Belief Shards.
- 10 Silver Chests.

The creation success message now shows the actual granted rewards with configured custom emojis and suggests the next useful actions:

- `crd summon 10` or `/summon count:10`
- `crd open sc 10` or `/open type:sc amount:10`

## Summon system

Implemented in `src/commands/rpg/summon.js`, `src/engine/summonEngine.js`, `src/engine/renderSummon.js`, and `src/config/gachaRates.js`.

- Spend currency: Belief Shards.
- Cost: 100 Belief Shards per pull.
- Allowed count: any integer from 1 through 30.
- Command is all-or-nothing: the full cost must be available before pulls run.
- Pull results are committed before animation/render display.
- Duplicate deities grant tier essence.
- Believer/reputation EXP for summon is handled through the command EXP path.

Current tier rates:

- Epic: 64.5%, displayed as Remnant.
- Mythic: 30%, displayed as Awakened.
- Legendary: 5%, displayed as Undying.
- Supreme: 0.5%, displayed as Primordial.

Pity:

- Pity threshold is 500.
- Legendary or Supreme natural rolls reset pity.
- A threshold-forced Legendary resets pity.
- Forced Supreme from a Supreme Relic does not touch pity.

Summon display:

- Normal, base, founder, and store summon skins use an animated header emoji.
- Equipping a non-tester summon skin changes only that header emoji.
- Tester summon sets may use full-size suspense media and a colocated `flip_seconds` setting.
- Tester media is suspense-only and disappears when the summon result replaces it.
- Results show the post-summon Belief Shards and Sacred Relics balance.

## Chest/opening system

Implemented in `src/commands/rpg/open.js`, `src/config/dropRates.js`, `src/config/runes.js`, and `src/engine/chestOpen.js`.

Chest aliases:

- `sc` Silver Chest
- `gc` Gold Chest
- `btc` Boss Treasure Chest
- `bgtc` Boss Golden Chest
- `supc` Supreme Chest

Chest opening syntax:

- Prefix: `crd open <sc|gc|btc|bgtc|supc> [amount]`
- Slash: `/open type:<alias> amount:<amount>`
- Normal chests can open up to 20 at a time.
- Supreme Chest is capped at 1 per command.

Chest drop rates:

- Silver: Rare 85%, Mythic 15%.
- Gold: Rare 65%, Mythic 30%, Legendary 5%.
- Boss Treasure: Rare 50%, Mythic 40%, Legendary 10%.
- Boss Golden: Mythic 45%, Legendary 45%, Supreme 10%.
- Supreme: Legendary 70%, Supreme 30%.

Gear drops:

- Each chest drop rolls weapon or armor with a 50/50 split.
- Weapons roll ATK and CRIT only.
- Armor rolls HP and DEF only.
- Fresh drops roll native socket counts by tier.

Relic opening:

- `crd open sr` consumes 1 Sacred Relic and performs 10 deity pulls.
- `crd open supr` consumes 1 Supreme Relic and performs 1 forced Supreme deity pull.
- Relics reject amount arguments.

Rune bag opening:

- `crd open lb [amount]` opens Lesser Rune Bags.
- `crd open gb [amount]` opens Greater Rune Bags.
- `crd open db [amount]` opens Divine Rune Bags.
- Rune bags open up to 20 at a time.

## Economy/currencies

Primary user bag fields include:

- Credux: general earned/spend currency.
- Belief Shards: summon currency.
- Sacred Relics and Supreme Relics: summon ticket items.
- Silver, Gold, Boss Treasure, Boss Golden, and Supreme Chests.
- Lesser, Greater, and Divine Rune Bags.
- Epic, Mythic, Legendary, and Supreme Essence.
- Valor Medals for ranked/PvP shop systems.

Economy commands:

- `crd cred` checks Credux without requiring a character.
- `crd bestow @user <amount>` transfers Credux subject to daily receiver caps.
- `crd daily` grants daily Credux, shards, and a chest based on streak day.
- `crd quests` / `crd quest` view and claim quest rewards.
- `crd exchange` buys rune bags from essence.
- `crd exchange essence` converts essence upward.

Casino code exists under `src/casino` and command wrappers exist, but current command routing points casino commands to `src/commands/casino/disabled.js`.

## Equipment/runes/relics

Equipment:

- One weapon slot and one armor slot are implemented.
- `crd equipment info <id>` handles weapon or armor info.
- `crd equip <id>` equips owned weapon/armor by ID.
- `crd enhance <id>` enhances gear.
- `crd lock <id>` and `crd unlock <id>` protect gear from sell actions.
- `crd sell` supports selling by ID, tier, or all.

Current stat assembly:

- HP = class + armor + deity + rune/resonance modifiers.
- ATK = class + weapon + deity + rune/resonance modifiers.
- DEF = class + armor + deity + rune/resonance modifiers.
- CRIT = class + weapon + Precision/rune/resonance points.
- v5 stat assembly is uncapped for player CRIT in `src/engine/statAssembly.js`.

Runes:

- Rune families: Sharpness, Precision, Vampiric, Piercing, Venom, Vitality, Bulwark, Thorns, Warding, Aegis Rune.
- Glossary categories are **Offensive Runes** (Sharpness, Precision, Vampiric, Piercing, Venom) and **Defensive Runes** (Vitality, Bulwark, Thorns, Warding, Aegis Rune), each sorted Supreme through Rare.
- Thorn Rune's per-instance stored reflect roll is Rare 5–10%, Mythic 12–15%, Legendary 18–20%, and Supreme 25–30%. It rolls once when the rune drops; existing owned runes are not rerolled and bag/drop odds are unchanged.
- Stat runes feed stat assembly.
- Combat-effect runes are passed into battle fighter structs as effect runes.
- Sockets are JSONB arrays on `user_weapons` and `user_armors`.
- Native sockets are rolled at drop. Opposite socket support exists in schema/config and `crd unlock socket` command support.
- Unsocket costs and rune sell prices are configured in `src/config/runes.js`.

Relics:

- Sacred Relic opens a 10-pull deity summon.
- Supreme Relic opens one forced Supreme deity pull.

## 2026-07-30 patch — Implement RPG balance and passive overhaul

<!-- Updated: 2026-07-30 | Patch: Implement RPG balance and passive overhaul | Commit: 5e76cfc -->

This section supersedes conflicting passive, armor, boss, reward, cooldown, rune, and
display statements in the older v4.2/v5 exports. The complete key-to-handler ledger is
`assets/data/passive_registry_keys.md`; every listed key is implemented by
`src/engine/passiveRegistry.js`.

### Display, commands, and blessing channels

- All command cooldown constants remain separate, but every existing value is now 15 seconds.
- `crd stats` labels its two combat channels **Primary Blessing** and **Secondary Blessing**.
  A blessing is active and visible only when its deity is ascended. The display reads
  `Deity not ascended` or `Locked` as applicable; an Echo deity equipped in slot 1 is
  still the Primary channel.
- Deity-grid and summon canvases register bundled DejaVu Sans regular/bold, preventing
  missing-glyph boxes on hosts without a usable system font.
- Equipment comparison rows are `ID tier-icon equipment-icon item name`. Weapon and armor
  collection/glossary/chest rows use the same tier icon before the equipment icon; bag
  pages place the tier icon on the second, stats line before the tier name.
- The one-page avatar carousel now emits distinct disabled Previous/Next component IDs.
  Equipped stats avatars keep their asset path if the advisory R2 HEAD probe fails; the
  renderer attempts the actual image source and caches availability separately.
- Cache revisions for these visuals are Deity grid 4 and Stats 19. The former clears the
  shared empty-grid font fallback; the latter clears previously cached stats-avatar fallbacks.

### Balance and reward values

- CRD shop: Greater Rune Bag 2,000,000; Divine Rune Bag 5,000,000; Diamond Chest 500,000 Credux.
- Raid rewards (`regular` / `elite` keys): regular 500–1,000 Credux, 200–300 Combat EXP,
  5–10 Belief Shards; elite 1,500–2,000 Credux, 400–600 Combat EXP, 15–20 Belief Shards.
- Greater Boss rules are recorded in the Boss section below. The golden variant uses the
  existing `boss_golden_chest` item only.

### Combat resolution contract

- Damage reduction is additive and capped at 70%. Incoming-hit order is evade → full-hit
  block/negation → raw post-DEF damage → summed reduction → Brokkr per-hit cap → apply
  damage → separate non-recursive reflects → on-hit stacks.
- Reflect is the exact configured percentage of final damage taken; it is not amplified
  again by Frostbite/Petrify and can carry reflect-specific defeat attribution.
- Cursed Edge, Death Charm, lethal DOTs, and reflect all pass a cause of death through the
  result and battle log. Soul Drain heals 30% of actual HP removed after mitigation,
  including valid additional attacks, Bash/counters, reflect, burst effects, and sourced DOTs.
<!-- Follow-up updated: 2026-07-30 | Patch: Fix Juru Pakal Bloodhunter bleed detection | Commit: pending -->
- The canonical bleed tag is applied to ordinary Bleed, Hemorrhage, Rupture, and Venom.
  Juru Pakal's Bloodhunter therefore recognizes the visible Bleed DOT and logs its +50%
  conditional damage when the tagged effect is active at attack time. Its damage lane is
  +10% without Bleed and +60% total with Bleed (1.10x and 1.60x versus neutral); like ATK
  modifiers add in the shared pipeline rather than multiplying to 1.65x.
- A real evasion renders `Evaded!` without a `0 DMG` line. Full absorption/negation such as
  Ironhide, Shieldmaiden's Guard, and Stone Skin remains a zero-damage hit, not an evasion.
- Attack and landed-hit hooks are distinct. A crowd-control skip, evade, or full negation
  cannot proc a landed-hit effect. Queued next-attack effects survive a skipped turn and are
  consumed only when a real attack begins.
- Weapon and armor log policy: persistent bonuses announce once per battle, stack growth
  announces only when a stack is gained, and chance/reactive effects announce only when
  they actually alter a hit or status application. The exhaustive audit covers all 71
  weapon keys and all 20 distinct armor keys.

### Armor passive values

| Passive | Live rule |
|---|---|
| Battersea Shield — Iron Stance | +3% reduction at the start of each turn, cap 15%. |
| Dipylon Shield — Hoplite Wall | +30% DEF during turns 1–3 only. |
| Enderby Shield — Thornward | Reflect 12% of post-mitigation damage. |
| Pelte — Deflection | 20% per incoming hit to halve that hit. |
| Vatican Aspis — Sacred Guard | 8% reduction and 12% outgoing damage. |
| Salakot Ward — Spirit Ward | 35% per debuff/CC application to negate it. |
| Wolfskin Cloak — Wolf's Vigor | Heal 3% max HP at turn start, or 6% below 50% HP. |
| Anting-Anting Sash — Charmed Hide | Nullify first CC each battle; later CC has 40% resist. |
| Hoplite Panoply — Phalanx Wall | 20% reduction; first hit gains another 30%. |
| Luzon Tribal Shield — Tribal Ward | +45% DEF while debuffed; heal 8% max HP per expiry/cleanse. |
| Shield of the Valkyrie — Valkyrie's Resolve | Each hit grants 5% reduction and +5% ATK, each capped at 25%. |
| Skjaldmaer — Shieldmaiden's Guard | Reflect 20%; separately 10% per hit to negate and reflect 60% of would-be damage. |
| Aegis — Medusa's Gaze | Each hit adds 7% reduction; at 3 stacks Petrify attacker for 1 turn, then reset. |
| Helm of Darkness — Veil of Hades | 30% evade; successful evade grants Unseen for next attack, ignoring 50% DEF. |
| Mail of Brokkr — Dwarven Forge | 30% reduction, 18% reflect, and a 15% max-HP cap per hit. |
| Mantle of Bathala — Divine Aegis | Per turn +6% max HP/current HP and +4% reduction; caps 30%/20%; at cap heal 8% max HP each turn. |
| Kalasag — Bulwark Hide | 3% incoming-damage reduction. |

### Reworked deity, weapon, and mob mechanics

- Bathala gains +10% ATK and +4% DEF per turn, caps +100%/+40%. Magwayen and Echo Magwayen
  use 30% Soul Drain. Odin stores 25% prevented damage on even turns and adds it to the next
  odd-turn attack. Zeus rolls a 50% +50% damage Chain Lightning per real attack; a landed
  proc adds a 5% DEF shred, stacking to 30%.
- Echo Habagat rolls per real attack. Echo Vidar's +30% revenge and Echo Idiyanale's double
  damage are durable next-attack queues, not passive-phase bonuses that can leak or expire on
  a skipped turn.
- Alan's Reversed Hands and Gridr give +20% outgoing damage; Alan blocks status effects but
  not DOTs, while Gridr has a 20% per-hit full negation. Gram ignores 25% DEF and gains 30%
  damage above 50% target HP. Juru Pakal gains 10% outgoing damage plus 50% against a
  bleed-tagged target. Jarngreipr adds 20% outgoing damage and a 50% Bash when its Stun lands.
- Freyr's Arrow has a 30% additional 100% ATK shot; Galdrastafir applies 20% DEF down for
  one turn on a landed hit; Gusisnautar's 50% Hemorrhage is 5% target max HP plus 15% DEF down.
  Badiang's 30% proc Ruptures for 10% target max HP then applies 10% ATK Venom for two ticks.
  Bosses block Gusisnautar and Rupture bursts but not Badiang Venom. Death Charm and Tyrfing
  executes do not affect bosses.
- Spear of Ares gains +10% ATK each turn to +50%. Tyrfing gains +10% each turn to +30% and
  executes non-boss targets below 10% max HP. Kiri's attack ramp reaches +120%; Katana adds
  30% damage to each attack; Gungnir ignores 40% DEF with a 25% full-pierce chance; a critical
  Thunderbolt of Zeus attack gains +100% ATK and Paralyze for one turn.
- Amalanhig, Dark Elf, and Lamia roll only after a landed mob hit. Harpy/Cyclops cadence
  skills arm the next real attack and apply their rider only when it lands. Chimera cycles
  Lion Claw 140% ATK → Goat Ram 20% player DEF down → Serpent Bite Burn at 20% Chimera ATK.
  Hydra regenerates 1% max HP every third turn.

### Description synchronization

- `scripts/final-passive-description-updates.sql` and
  `scripts/update-final-passive-descriptions.js` are transactional, manual database sync
  sources; they are not executed by deployment automatically. They cover 52 rows (38 deity,
  10 weapon, 4 mob), including the corrected Magwayen, Gungnir, Thunderbolt of Zeus, Katana,
  Kiri, Juru Pakal, Amalanhig, Dark Elf, Lamia, and Chimera wording. The separate
  `scripts/deity-passive-description-update.sql` covers Bathala, Odin, and Zeus naming/text.
- The release audit verified 176 registry keys (including `none`) against the active roster:
  68 weapons, 24 armors, 41 deities, and 38 mobs. No active key lacked a handler.

## Battle/raid/PvP systems

Battle engine:

- Core battle resolution is in `src/engine/battleEngine.js`.
- Fighter assembly is in `src/engine/statAssembly.js`.
- Battle rendering is in `src/engine/battleRender.js`.
- Passive hooks are in `src/engine/passiveRegistry.js`.
- Raids and boss attacks use active battle state/guards; duels are in-memory with duel locks.

Raid:

- `crd raid` spawns a random regular/elite mob.
- Elite spawn chance is configured in `src/config/raidLoot.js`.
- Mob level is player level plus a random offset from -2 to +15, clamped 1 to 55.
- Rewards include Combat EXP, Credux, Belief Shards, and possible Silver/Gold chest on wins.
- Rewards commit before visual rendering.

Auto raid:

- `crd auto raid` is implemented as an idle reward timer.
- Rewards are deterministic expected value based on the snapshotted combat level and current raid-loot config.
- Grants Combat EXP, Credux, and Belief Shards only; no chests.

Duel:

- `crd duel @user [level N]` creates an accept/decline challenge.
- Casual duels grant no direct drops, EXP, or Credux.
- Casual duel results update PvP win/loss counters and quest progress.
- `crd duel wager @user <amount>` exists, capped at 50,000 Credux per duel and shares the daily receiver cap.

Ranked/PvP:

- `crd ranked` auto-matches against a real-user snapshot in rating range.
- Only the challenger's rating changes.
- Rating deltas and Valor rewards are dynamic and configured in `src/config/ranked.js`.
- Ranked rewards require an active season for Valor.
- `crd ranked claim` grants weekly rewards after the weekly minimum games.
- `crd pvp shop` and `crd pvp buy` spend Valor Medals on capped seasonal items.

Boss:

- `crd boss` re-posts current server boss status.
- Boss scheduler checks configured channels and active players.
- Boss reward constants live in `src/config/bosses.js`.
- Boss attacks and reward commits are handled in `src/engine/bossSystem.js`.
- Normal boss HP/ATK/DEF/CRIT use database values directly. A Greater Boss has a 30% spawn chance; its nested variant roll is 75% Twin Chest or 25% Boss Golden Chest. Twin: base HP ×2 + normal level scaling, 2 Boss Treasure Chests, 150,000 Credux, 30,000 Combat EXP, 1,500 Belief Shards. Golden: base HP ×3 + normal level scaling, 1 Boss Golden Chest, 200,000 Credux, 40,000 Combat EXP, 2,000 Belief Shards. ATK/DEF/CRIT remain unmultiplied. No separate Golden Treasure Chest item exists.

## Asset/R2/caching behavior

Static assets:

- Local asset root is `assets/`.
- `ASSET_BASE_URL` enables remote public asset URLs, intended for Cloudflare R2.
- Without `ASSET_BASE_URL`, local assets are attached/uploaded to Discord.
- `ASSET_VERSION` appends a cache-busting query string to remote asset URLs.
- Asset buffer/image loading uses in-memory LRU-style caches with environment-tunable max entries, max MB, and TTL.
- Remote asset fetch failures can fall back to local files when a relative asset path can be resolved.

R2 writes:

- `src/utils/r2Client.js` implements minimal S3 SigV4 PUT/DELETE for Cloudflare R2.
- Required write env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

Canvas cache:

- `src/utils/canvasCache.js` caches deterministic rendered canvases.
- Layers: process memory -> `canvas_cache` table -> render and R2 PUT.
- Object keys use `cache/canvas/<hash>.<jpg|png>`.
- Cache keys include `ASSET_VERSION` and caller-supplied render revision/input parts.
- `sweepCanvasCache()` evicts cold entries and deletes R2 objects.
- In production, `index.js` refuses to start if Discord image attachments are disallowed and canvas cache/R2 readiness is missing.

Emoji registry:

- `src/utils/emojis.js` loads `assets/data/game_items.txt`, `game_deities.txt`, and `skins.txt`.
- Known animated emoji names render with `<a:name:id>`.
- Startup audits warn for missing/stale emoji IDs and unresolved roster names.

## Production/deployment notes

Environment required at minimum:

- `BOT_TOKEN`
- `CLIENT_ID`
- `DATABASE_URL`
- `DEV_IDS`

Production/preflight notes:

- `scripts/production-preflight.js --prod` checks env, dangerous flags, R2/static asset config, required local assets, DB tables, columns, and indexes.
- `prod-ca-2021.crt` is used for TLS DB preflight connections.
- `scripts/deploy-commands.js` registers slash commands. If `GUILD_IDS` is set, commands register per guild; otherwise they register globally.
- `index.js` can sync slash commands on startup through `src/utils/slashCommandSync.js`.
- Graceful shutdown handles SIGTERM/SIGINT, destroys the Discord client, and drains the pg pool.
- Production egress guard can refuse startup when image attachment/R2 settings would cause unsafe Discord upload egress.

Important scripts:

- `npm start`
- `npm run dev`
- `npm run selftest`
- `npm run selftest:full`
- `npm run preflight`
- `npm run preflight:prod`
- `node scripts/deploy-commands.js`

## Known TODOs or planned systems

These items are present in older masterfiles or comments but are not fully live unless stated above:

- World Boss as a distinct future reward tier is not implemented as a separate live player-facing system in current routing; current boss behavior is server boss based.
- Supporter Stripe webhook host is not implemented in this bot. Supporter entitlement functions and dev simulation commands exist.
- Battle-result skins are supported by resolver/preview infrastructure and result rendering paths are being passed in battle flows, but older docs note result-skin compositing was not fully wired at one stage; verify visually when changing this area.
- Banner/reward-track systems from v5 are deferred.
- Some slash coverage lags prefix-only systems. Prefix help marks runes, ranked/idle, supporter shop, and related systems as prefix-only.
- Casino engines and assets exist, but public casino commands are currently routed to the disabled command wrapper.
- Old docs contain v4/v5 contradictions around max summon count, weapon HP/DEF, shield weapons, crit caps, and chest max-open values. Current code wins: summon max is 30, weapons are ATK/CRIT, armor carries HP/DEF, player CRIT is uncapped in stat assembly, normal chest max-open is 20, and Supreme Chest max-open is 1.
