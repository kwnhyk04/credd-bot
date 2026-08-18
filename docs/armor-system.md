# Armor System

Armor is the HP and DEF half of your gear in Credd. Every character has exactly one armor
slot. Armor drops from the same chests as weapons, rolls HP and DEF within tier-and-type
bands, carries a defensive passive, and can hold rune sockets. This document covers armor
tiers and types, stat ranges, every armor passive, and the armor commands.

Armor rolls **HP and DEF only** — it never grants ATK or CRIT. Weapons are covered in the
Weapon System document.

## What armor types exist

<!-- src: src/config/dropRates.js:61 -->

Three types: **Heavy, Medium and Light**. At drop each type is equally likely (1/3 each).

Each type positions its rolled HP and DEF differently inside the tier range:

<!-- src: src/config/dropRates.js:120 -->

| Type | HP profile | DEF profile | Character |
|---|---|---|---|
| Heavy | Low (bottom 40%) | Highest (top 20%) | Tanky DEF, modest HP |
| Medium | Balanced (mid 40–60%) | Balanced (mid 40–60%) | Even split |
| Light | Highest (top 20%) | Low (bottom 40%) | Big HP pool, low DEF |

Band windows:

<!-- src: src/config/dropRates.js:83 -->

| Profile | Window of the tier range |
|---|---|
| Low | 0% – 40% |
| Balanced | 40% – 60% |
| Highest | 80% – 100% |

## What armor tiers exist

<!-- src: scripts/production-consolidated-schema.sql:836 -->

| Tier | Source |
|---|---|
| Common | Starter gear only (Initiate's Garb) |
| Rare | Silver, Gold, Boss Treasure chests |
| Mythic | Silver, Gold, Boss Treasure, Boss Golden, Diamond chests |
| Legendary | Gold, Boss Treasure, Boss Golden, Supreme, Diamond chests |
| Supreme | Boss Golden, Supreme chests |

There is **no Divine armor tier** — Divine is weapon-only.

## What are the armor stat ranges by tier

<!-- src: src/config/dropRates.js:112 -->

| Tier | HP range | DEF range |
|---|---|---|
| Rare | 100 – 200 | 50 – 75 |
| Mythic | 300 – 400 | 80 – 150 |
| Legendary | 600 – 800 | 200 – 300 |

Both values are floored to whole numbers.

Supreme armor does not roll — it is fixed by type:

<!-- src: src/config/dropRates.js:127 -->

| Supreme type | HP | DEF |
|---|---|---|
| Heavy | 1,000 | 600 |
| Medium | 1,200 | 500 |
| Light | 1,400 | 400 |

## How do I get armor

Armor and weapons share the same chests. Each individual drop rolls its gear class after
the tier is decided.

<!-- src: src/config/dropRates.js:58 -->

| Roll | Chance |
|---|---|
| The drop is a weapon | 50% |
| The drop is an armor | 50% |

There is no armor-only chest. The one exception is the Divine Chest, which is
weapon-only and skips the split entirely.

Starter armor is granted at character creation: **Initiate's Garb**, Common, 40 HP,
10 DEF, equipped automatically.

## How many rune sockets does armor have

Native socket count is rolled once, at drop, by tier. Armor native sockets are the
**defense** lane.

<!-- src: src/config/dropRates.js:155 -->

| Tier | 0 sockets | 1 socket | 2 sockets |
|---|---|---|---|
| Common | 100% | — | — |
| Rare | — | 70% | 30% |
| Mythic | — | 40% | 60% |
| Legendary | — | — | 100% |
| Supreme | — | — | 100% |

Only defense-lane runes fit armor native sockets. Attempting to socket an offense rune
replies with a lane mismatch error.

## How do I equip and inspect armor

Armor uses the same commands as weapons — IDs are unique across both gear tables, so the
commands detect the kind automatically.

| Command | Alias | Slash | Syntax |
|---|---|---|---|
| Equip | `crd eq <id>` | `/equip weapon_id:` | `crd equip <id>` |
| Info card | `crd ei <id>` | `/equipment info equipment_id:` | `crd equipment info <id>` |
| Compare | `crd cmp` | Not available | `crd compare armor <a> <b> [c]` |
| Lock | `crd lk <id>` | `/lock weapon_id:` | `crd lock <id>` |
| Unlock | `crd ulk <id>` | `/unlock weapon_id:` | `crd unlock <id>` |
| Browse | `crd ba` | Not available | `crd bag armors` |
| Enhance | `crd enh <id>` | `/enhance weapon_id:` | `crd enhance <id>` |
| Sell | — | `/sell target:` | `crd sell <id>` |

`crd equip` writes to your currently active equipment **preset** only. Credd has two
independent presets per character — see `crd preset` and `crd equip preset <1|2>` in the
character system document.

<!-- src: src/engine/loadout.js:1 -->

Examples:

```text
crd equip 7k2m9x1p
crd equipment info 7k2m9x1p
crd compare armor 7k2m9x1p 3n8v4z6q
crd bag armors
```

Equipping replies with the resolved item, e.g. `Equipped **Mail of Brokkr** (Supreme
Heavy) +6.`

## How does armor enhancement work

Armor uses the same boost table as weapons and caps at +10. Armor never reaches the
Divine +20 cap, which is weapon-only.

<!-- src: src/engine/enhancement.js:168 -->

```js
curr_hp  = floor(base_hp  * WEAPON_BOOST_TABLE[enhancement])
curr_def = floor(base_def * WEAPON_BOOST_TABLE[enhancement])
```

Full costs, success rates and the boost table are in the Enhancement System document.

## What do the Philippine armor passives do

<!-- src: assets/data/passive_registry_keys.md:87 -->

| Armor | Passive | Effect |
|---|---|---|
| Kalasag | Bulwark Hide | Reduces incoming damage by 3% (post-DEF) |
| Salakot Ward | Spirit Ward | 35% chance per application to negate an incoming debuff or crowd-control effect |
| Anting-Anting Sash | Charmed Hide | Takes 10% less damage. The first crowd-control effect each battle is fully nullified, of any type. Afterwards a 40% chance to resist Stun, Petrify or Freeze specifically |
| Luzon Tribal Shield | Tribal Ward | +45% DEF while debuffed; heals 8% max HP whenever a debuff expires or is cleansed |
| Mantle of Bathala | Divine Aegis | Gains 6% max HP and 4% damage reduction each turn, stacking to 30% and 20%. At max stacks also heals 8% max HP each turn |

## What do the Norse armor passives do

<!-- src: assets/data/passive_registry_keys.md:87 -->

| Armor | Passive | Effect |
|---|---|---|
| Mail of Brokkr | Dwarven Forge | Reduces damage taken by 30%, caps each hit at 15% max HP, then reflects 20% of the final post-mitigation damage. Order is reduction, then cap, then reflect |
| Wolfskin Cloak | Wolf's Vigor | Heals 3% max HP at the start of each turn, or 6% while below 50% max HP |
| Valkyrie Mantle | Chooser's Grace | Starts at a 22% evade chance, gains 8 percentage points after each consecutive hit taken, and resets to 22% after evading |
| Shield of the Valkyrie | Valkyrie's Resolve | Each hit taken grants 5% damage reduction and +5% ATK, each stacking up to 25% for the battle |
| Skjaldmaer | Shieldmaiden's Guard | Reflects 20% of damage taken. Each hit also has a 10% chance to be fully negated and reflect 60% of its would-be damage instead — the two reflects never apply to the same hit |

## What do the Greek armor passives do

<!-- src: assets/data/passive_registry_keys.md:87 -->

| Armor | Passive | Effect |
|---|---|---|
| Hoplite Panoply | Phalanx Wall | Reduces damage taken by 20%; the first hit taken each battle gains another 30% reduction |
| Dipylon Shield | Hoplite Wall | DEF +30% during turns 1 through 3 |
| Pelte | Deflection | 20% chance per incoming hit to halve that hit's damage |
| Aegis | Medusa's Gaze | Each hit taken adds a Stone stack granting 10% damage reduction. At 3 stacks the attacker is Petrified for 1 turn and takes 50% more damage, then the stacks reset. Effective maximum is 2 stacks (20%) |
| Helm of Darkness | Veil of Hades | 30% chance to evade each incoming hit. A successful evade grants Unseen, making the next attack ignore 50% of the target's DEF |

## What do the remaining armor passives do

These keys came from shield-type weapons before shields were migrated to armor.

<!-- src: assets/data/passive_registry_keys.md:82 -->

| Armor | Passive | Effect |
|---|---|---|
| Steel Kite Shield | Bulwark | 10% chance to block 15% of incoming damage |
| Reinforced Targe | Opening Strike | The first hit deals +20% ATK |
| Vatican Aspis | Sacred Guard | Reduces damage taken by 8% and increases outgoing damage by 12% |
| Battersea Shield | Iron Stance | Gains 3% damage reduction at the start of each turn, stacking up to 15% |
| Enderby Shield | Thornward | Reflects 12% of post-mitigation damage taken back to the attacker |

## How do armor reductions and reflects combine

All damage-reduction sources on a defender are summed into one additive total, capped at
**70%**. Reflect sources resolve separately against the final damage taken, and reflected
damage never re-enters the defender stack.

| Rule | Value |
|---|---|
| Maximum total damage reduction | 70% |
| Mail of Brokkr per-hit cap | 15% of max HP |
| Order | evade → full negation → post-DEF damage → summed reduction → damage increases → Brokkr cap → apply → reflects → on-hit stacks |

Full ordering detail is in the Combat System document.

An evade shows `Evaded!` with no damage line. A full negation (Ironhide, Shieldmaiden's
Guard, Stone Skin) is a zero-damage hit, not an evasion.

## How much is armor worth when sold

Armor uses the same sell table as weapons: a tier base price plus 30% of the canonical
enhancement costs for levels successfully reached.

<!-- src: src/config/sellPrices.js:13 -->

| Tier | Base sell price (Credux) |
|---|---|
| Common | 100 |
| Rare | 1,000 |
| Mythic | 50,000 |
| Legendary | 100,000 |
| Supreme | 1,000,000 |

Legendary and Supreme armor is excluded from `crd sell all` and must be sold individually
or by explicit tier. Equipped and locked armor cannot be sold at all.

## Where can I look up armor I do not own

`crd glossary` has an Armors category listing every available armor with its tier, type
and passive, ordered Supreme down to Common, up to 10 entries per page.
