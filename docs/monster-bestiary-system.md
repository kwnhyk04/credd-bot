# Monster & Bestiary System

Every enemy in Credd comes from one shared monster roster, split into three types:
regular mobs and elite mobs (which spawn from `crd raid`) and bosses (which are spawned by
a scheduler). Each monster carries a mythology, a stat block (level-scaling for regular
and elite; fixed for bosses), an immunity list, and exactly one skill. This document lists
the monster types, the scaling formulas, every monster skill, and the Greater and Calamity
Boss tiers.

Monsters are drawn from Philippine, Norse and Greek mythology.

## What types of monsters exist in Credd

<!-- src: scripts/production-consolidated-schema.sql:257 -->

| Type | Where it appears | Spawn chance in a raid |
|---|---|---|
| `regular` | `crd raid` | 80% |
| `elite` | `crd raid` | 20% |
| `boss` | Scheduled boss spawns in the official support server | Never from `crd raid` |

Within a raid category every monster of that type is equally likely.

## How do monster stats scale with level

Regular and elite mobs scale with the level they spawn at. Bosses do not — a boss has no
gameplay level at all and always fights at its fixed roster stats.

<!-- src: src/engine/statAssembly.js:214 -->

```js
// Regular / elite
hp   = floor(base_hp  + hp_per_level  * level)
atk  = floor(base_atk + atk_per_level * level)
def  = floor(base_def + def_per_level * level)
crit = base_crit
```

<!-- src: src/engine/statAssembly.js:341 -->

```js
// Boss — level argument does not exist; these are the fixed roster values
hp   = base_hp
atk  = base_atk
def  = base_def
crit = base_crit
```

The per-level term for regular/elite is multiplied by `level`, not `level - 1`, and CRIT
never scales for any monster type.

Per-level growth by monster type:

<!-- src: scripts/patch_mob_scaling_v9.sql:16 -->

| Type | HP per level | ATK per level | DEF per level |
|---|---|---|---|
| Regular | +20 | +8 | +5 |
| Elite | +40 | +15 | +10 |
| Boss | Not applicable — bosses have no per-level scaling |

Base HP, ATK, DEF and CRIT are per-monster values stored in the roster.

## What level do monsters spawn at

Only regular and elite mobs have a spawn level. Bosses have none.

| Monster type | Level formula | Clamp |
|---|---|---|
| Regular / elite (raid) | `playerLevel + uniform(-2, +15)` | 1 to 120 |
| Boss | Not applicable — bosses have no gameplay level |

<!-- src: src/engine/statAssembly.js:225 -->

## What data does each monster carry

<!-- src: scripts/production-consolidated-schema.sql:257 -->

| Field | Meaning |
|---|---|
| `name` | Display name |
| `mythology` | `PH`, `Norse` or `Greek` |
| `mob_type` | `regular`, `elite` or `boss` |
| `base_hp` / `base_atk` / `base_def` / `base_crit` | Level-1 stat block; CRIT is a flat percentage |
| `hp_per_level` / `atk_per_level` / `def_per_level` | Level scaling |
| `skill_key` / `skill_name` / `skill_description` | The monster's single passive skill |
| `immunity_tags` | Effects this monster cannot be afflicted by |
| `special_flags` | Behaviour flags, e.g. `first_strike` |

A monster with `special_flags.first_strike` always acts first, even against the boss rule
that normally lets the player strike first.

## What are the Philippine mythology monster skills

<!-- src: assets/data/passive_registry_keys.md:170 -->

| Monster | Skill | Effect |
|---|---|---|
| Dwende (Black) | Hex | 25% chance to reduce the player's ATK by 15% for 1 turn |
| Dwende (White) | Daze | 20% chance to reduce the player's CRIT by 50% for 1 turn |
| Amalanhig | Infectious Bite | Each attack has a 30% chance to inflict Rot equal to 5% of the player's max HP per turn for 2 turns |
| Amomongo | Rend | Every 3rd turn, deals 150% ATK |
| Bal-Bal | Carrion Sense | While the player's HP is below 30%, ATK +20% |
| Santelmo | Will-o-Wisp | 20% chance each turn to make the player skip their next attack |
| Manananggal | Viscera Drain | Every 3 turns, drains 15% of the player's max HP and heals itself |
| Aswang | Shape Shift | Every 4 turns, copies the player's current ATK for 2 turns |
| Tikbalang | Disorientation | Every 3 turns, reduces the player's ATK by 20% for 1 turn |
| Kapre | Smoke Cloud | Every 4 turns, reduces the player's CRIT by 30% and ATK by 10% for 1 turn |
| Sigbin | Shadow Step | 20% chance to evade any incoming attack |
| Batibat | Sleep Paralysis | Every 4 turns, paralyzes the player for 1 turn (guaranteed skip) |

Amalanhig rolls only after a landed monster hit.

## What are the Norse mythology monster skills

<!-- src: assets/data/passive_registry_keys.md:182 -->

| Monster | Skill | Effect |
|---|---|---|
| Troll | Regeneration | Recovers 5% max HP at the start of each turn |
| Dwarves | Stone Skin | Every 4 turns, absorbs the next hit, up to 20% max HP |
| Dark Elves | Curse of Decay | Each attack has a 25% chance to reduce the player's DEF by 10% for 1 turn |
| Light Elves | Radiant Strike | 20% chance to blind the player (CRIT reduced to 0% for 1 turn) |
| Ratatoskr | Slander | Every 3 turns, reduces the player's ATK by 20% for 1 turn |
| Fossegrim | Enchanting Melody | Every 4 turns, the player skips their next turn |
| Nokken | Luring Form | Every 3 turns, reduces the player's DEF by 20% for 1 turn |
| Valkyrie | Battle Judgment | Every 4 turns, its next attack deals 200% ATK |

Dark Elves roll only after a landed monster hit.

## What are the Greek mythology monster skills

<!-- src: assets/data/passive_registry_keys.md:190 -->

| Monster | Skill | Effect |
|---|---|---|
| Satyr | Wild Revelry | 25% chance each turn to reduce the player's ATK by 15% for 1 turn |
| Harpy | Swooping Talons | Every 3rd turn, deals 150% ATK and reduces the player's DEF by 10% for 1 turn |
| Skeleton Warrior | Undying Resolve | While its HP is below 30%, DEF +25% for the rest of the battle |
| Lamia | Serpent Bite | Each attack has a 30% chance to add Bleed equal to 15% of Lamia's ATK per turn for 2 turns |
| Minotaur | Labyrinth Charge | Every 3 turns, deals 180% ATK — or 220% ATK if the player's HP is above 70% |
| Cyclops | Boulder Throw | Every 4 turns, deals 160% ATK and stuns for 1 turn |
| Chimera | Tri-Form Assault | Cycles through Lion Claw (140% ATK), Goat Ram (player DEF −20% for 1 turn), and Serpent Bite (Burn equal to 20% of Chimera's ATK per turn for 2 turns) |

Lamia rolls only after a landed monster hit. Harpy and Cyclops cadence skills arm the
next real attack and apply their rider only when it lands.

## What boss-only skills exist

<!-- src: assets/data/passive_registry_keys.md:198 -->

| Skill key | Skill | Effect |
|---|---|---|
| `hydra_regen` | Regeneration | Regenerates 1% max HP every 3rd turn on the local instance; only NET damage commits to the shared pool |
| `stone_stare` | Stone Stare | Every 3rd turn, petrifies the player for 1 turn, then resets the counter |
| `bakunawa_seven_moons` | Seven Moons | Two effects: (1) every 4th turn, Eclipse applies **Darkened** — the player's CRIT chance is reduced to 0% for 1 turn; (2) each time the boss's shared-pool HP first crosses one of six fixed thresholds (85/70/55/40/25/10%), its own ATK permanently rises by +10%, capping at +60% once all six are crossed. The threshold state persists across attackers and process restarts (durable boss `passive_state`), and each crossing is announced in the boss channel. |
| `none` | — | Shared no-op for monsters with no skill |

Boss Petrify from Stone Stare applies the default +25% damage amplification, not the +50%
that Aegis's Medusa's Gaze uses.

<!-- src: assets/data/passive_registry_keys.md:202 -->
<!-- src: src/engine/battleEngine.js:335 -->

Bakunawa is the only boss with a durable multi-attacker passive: because the shared HP
pool is fought by many separate local instances, its ATK ramp and crossed-threshold list
are stored on `boss_state.passive_state` (JSONB) rather than kept in memory, so the bonus
survives a bot restart and applies consistently to every attacker.

## Which monsters are Greater or Calamity Bosses

<!-- src: src/config/bosses.js:20 -->

Greater membership is **Jotun, Fafnir, and Cerberus**. Calamity membership is **Fenrir
and Bakunawa**. Tier is matched by exact monster name.

| Tier | Boss | Mythology |
|---|---|---|
| Greater | Jotun (Jötunn) | Norse |
| Greater | Fafnir | Norse |
| Greater | Cerberus | Greek |
| Calamity | Fenrir | Norse |
| Calamity | Bakunawa | `[UNVERIFIED]` — not confirmed against the `mob_roster.mythology` column in this repo |

The Norse giant is seeded as `Jotun` without the diacritic, and that is the exact string
the tier check matches. Hydra, a former Greater Boss, is now a normal boss with no HP
multiplier or tier-specific reward.

Natural spawn selection is 70% normal / 25% Greater / 5% Calamity. Full spawn, HP, and
reward details are in the Boss System document.

## What are monster immunities

Each monster row carries an `immunity_tags` array. A monster listed as immune to an
effect cannot receive it at all — the application is refused before any resist roll.

Notable immunity behaviour:

| Rule | Detail |
|---|---|
| Bosses and Gusisnautar | Bosses block both Hemorrhaging Shot effects |
| Bosses and Rupture bursts | Bosses block Badiang Stalk's Rupture but **not** its Venom |
| Bosses and executes | Bosses are immune to Death Charm and Tyrfing executes entirely |
| `armor_pierce` immunity | Gates the whole armor-pierce lane, including Gungnir full pierce and Archer class pierce |

The exact immunity list per monster is stored in the database roster and is not
reproduced here. [UNVERIFIED] — per-monster `immunity_tags` values are seed data and were
not read from a live database for this document.

## What are the per-monster base stats

Base HP, ATK, DEF and CRIT are authored per monster in the `mob_roster` table.
[UNVERIFIED] — individual per-monster base stat values are database seed data and are not
determinable from the repository source. What **is** determinable is the scaling applied
on top of them (the per-level table above) and the balance history:

<!-- src: scripts/patch_mob_rebalance.sql:20 -->

| Rebalance | Change |
|---|---|
| Mob rebalance patch | Regular mobs +80 base ATK, +50 base DEF; elite mobs +100 base ATK, +100 base DEF. Base HP unchanged. |
| Scaling patch v9 | Per-level growth reduced — regular from 40/15/10 to 20/8/5, elite from 75/30/16 to 40/15/10. Bases unchanged. |
| Bosses | Untouched by both patches above |

These are deltas applied to already-seeded rows, not the rows themselves, so the
resulting absolute `base_atk`/`base_def` for regular and elite monsters are still
`[UNVERIFIED]`. Regular and elite `base_hp` are also `[UNVERIFIED]` — no patch script
touches them, and no script sets `base_crit` for any monster type.

**Boss `base_hp` is the one absolute value the patch history does confirm**, for the 11
named boss rows it touched:

<!-- src: scripts/patch_raid_balance_v4_2.sql:20 -->

| Boss | Mythology | `base_hp` |
|---|---|---|
| Berberoka | PH | 65,000 |
| Bungisngis | PH | 62,000 |
| Anggitay | PH | 63,000 |
| Dalaketnon | PH | 63,500 |
| Jotun | Norse | 68,000 |
| Fenrir | Norse | 63,000 |
| Fafnir | Norse | 66,000 |
| Sleipnir | Norse | 62,000 |
| Cerberus | Greek | 64,000 |
| Hydra | Greek | 67,000 |
| Medusa | Greek | 63,500 |

No later script overwrites these — both the mob rebalance patch and scaling patch v9
explicitly leave bosses untouched — so this is presumed to still be live. Boss
`base_atk`, `base_def`, `base_crit` and per-level growth remain `[UNVERIFIED]`: the
sanity-check comment in that same patch script calls per-boss per-level values
"authored" directly in the database, not set by any script in this repository.

## Where can I browse monsters in game

There is no player-facing bestiary command. Monsters are encountered through `crd raid`
and `crd boss`; the in-game codex `crd glossary` covers Deities, Weapons, Armors and
Runes only.

| Command | Covers |
|---|---|
| `crd glossary` | Deities, Weapons, Armors, Offensive Runes, Defensive Runes |
| `crd raid` | Encounters regular and elite monsters |
| `crd boss` | Shows the current boss, its level, HP and skill |
