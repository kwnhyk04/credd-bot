# Rune System

Runes are socketable modifiers that boost your stats or add combat effects. They come out
of rune bags, are slotted into weapon and armor sockets, and each rolls its own value
when it drops. This document covers all ten rune effects, their per-tier value ranges,
the lane rules, rune bags, and the socket commands.

Runes are bought with essence, not Credux, and essence comes from duplicate deity pulls.

## What rune tiers exist

<!-- src: src/config/runes.js:22 -->

| Tier | Bag it comes from |
|---|---|
| Rare | Lesser Rune Bag |
| Mythic | Lesser and Greater Rune Bags |
| Legendary | Greater and Divine Rune Bags |
| Supreme | Divine Rune Bag |

The exact per-bag drop weights are stored in the `essence_bag_def.rune_pool` table.
[UNVERIFIED] — the per-bag weighted pools are database seed data and were not read from a
live database for this document.

## What are the two rune lanes

Every rune belongs to one lane, and a rune can only go into a socket of its own lane.

<!-- src: src/config/runes.js:28 -->

| Lane | Fits | Runes |
|---|---|---|
| Offense | Weapon native sockets | Sharpness, Precision, Vampiric, Piercing, Venom |
| Defense | Armor native sockets | Vitality, Bulwark, Thorns, Warding, Aegis Rune |

A lane mismatch is rejected: *"Lane mismatch: slot 2 is **offense**, but Vitality Rune is
**defense**."*

## What does each offensive rune do

<!-- src: src/config/runes.js:151 -->

| Rune | Effect |
|---|---|
| Sharpness | ATK +X% |
| Precision | CRIT +X (flat percentage points) |
| Vampiric | Lifesteal X% of damage dealt |
| Piercing | Ignore X% of enemy DEF |
| Venom | On hit: Poison for X% of ATK per turn, for 2 turns |

## What does each defensive rune do

<!-- src: src/config/runes.js:151 -->

| Rune | Effect |
|---|---|
| Vitality | HP +X% |
| Bulwark | DEF +X% |
| Thorns | Reflect X% of damage taken |
| Warding | Incoming damage-over-time reduced by X% |
| Aegis Rune | Incoming damage reduced by X% |

Sharpness, Precision, Vitality and Bulwark feed the stat-assembly pipeline. The other six
register as combat hooks in the battle engine.

## What are the rune value ranges

Each owned rune rolls its own value inside the range for its effect and tier. The rolled
value is stored on the rune and never rerolls.

<!-- src: src/config/runes.js:33 -->

| Rune | Rare | Mythic | Legendary | Supreme |
|---|---|---|---|---|
| Sharpness (ATK %) | 1 – 3 | 4 – 7 | 8 – 12 | 15 – 20 |
| Precision (CRIT points) | 1 – 2 | 3 – 6 | 7 – 10 | 12 – 15 |
| Vampiric (lifesteal %) | 1 – 3 | 4 – 7 | 8 – 12 | 15 – 20 |
| Piercing (DEF ignore %) | 2 – 4 | 5 – 7 | 8 – 13 | 15 – 20 |
| Venom (ATK % per turn) | 1 – 2 | 3 – 5 | 5 – 8 | 9 – 10 |
| Vitality (HP %) | 3 – 7 | 8 – 12 | 15 – 20 | 25 – 30 |
| Bulwark (DEF %) | 1 – 3 | 4 – 7 | 8 – 12 | 15 – 20 |
| Thorns (reflect %) | 5 – 10 | 12 – 15 | 18 – 20 | 25 – 30 |
| Warding (DOT reduction %) | 3 – 5 | 7 – 9 | 10 – 13 | 15 – 20 |
| Aegis Rune (damage reduction %) | 1 – 3 | 4 – 8 | 10 – 13 | 15 – 20 |

Two runes of the same name and tier can have different values. Existing owned runes are
never rerolled when ranges change.

## What are rune bags and how do I open them

<!-- src: src/config/runes.js:68 -->

| Bag | Open alias | Max per command |
|---|---|---|
| Lesser Rune Bag | `lb` | 20 |
| Greater Rune Bag | `gb` | 20 |
| Divine Rune Bag | `db` | 20 |

| Command | Syntax |
|---|---|
| Open | `crd open <lb\|gb\|db> [amount]` |

Slash equivalents exist as `/open type:lb amount:` and the same for `gb` and `db`.

Examples:

```text
crd open lb
crd open db 5
```

Opening plays a reveal animation and then lists every rune dropped with its ID, tier and
rolled value. Rune UIDs are 8 characters from `0-9a-z` in their own namespace.

## How do I buy rune bags

Two shops sell rune bags. The essence shop spends essence plus Credux; the CRD Shop
spends Credux only.

Essence shop:

<!-- src: src/config/runes.js:87 -->

| ID | Letter | Item | Essence cost | Credux cost |
|---|---|---|---|---|
| 1 | `lb` | Lesser Rune Bag | 10 Mythic Essence | 50,000 |
| 2 | `gb` | Greater Rune Bag | 10 Legendary Essence | 125,000 |
| 3 | `db` | Divine Rune Bag | 10 Supreme Essence | 250,000 |

| Command | Syntax |
|---|---|
| Browse | `crd essence shop` (alias `crd es`) |
| Buy | `crd exchange <lb\|gb\|db\|1\|2\|3> [qty]` (alias `crd ex`) |

Examples:

```text
crd essence shop
crd exchange lb 3
crd exchange 2
```

Buying is atomic — if you cannot afford the whole quantity nothing is spent, and the
reply tells you how many you *can* afford.

CRD Shop (Credux only, monthly caps):

<!-- src: src/config/crdShop.js:22 -->

| ID | Item | Price | Cap |
|---|---|---|---|
| 2 | Lesser Bag | 1,000,000 Credux | 10 per month |
| 3 | Greater Bag | 2,000,000 Credux | 5 per month |
| 4 | Divine Bag | 5,000,000 Credux | 3 per month |

## How do I convert essence between tiers

`crd exchange essence` is a continuous forge-style view. Ten of the lower tier plus
Credux makes one of the target tier. Conversion is one-way — never downward.

<!-- src: src/config/runes.js:101 -->

| Target essence | Costs | Credux |
|---|---|---|
| Mythic Essence | 10 Epic Essence | 50,000 |
| Legendary Essence | 10 Mythic Essence | 125,000 |
| Supreme Essence | 10 Legendary Essence | 250,000 |

Example:

```text
crd exchange essence
```

A dropdown picks the target tier and a Convert button resolves one conversion at a time,
re-rendering in place so you can convert repeatedly and stop when you like.

## How do I socket a rune

<!-- src: src/commands/rpg/socket.js:83 -->

| Command | Alias | Syntax |
|---|---|---|
| Socket | `crd so` | `crd socket <gear_id> <rune_uid> <slot#>` |
| Unsocket | `crd uso` | `crd unsocket <gear_id> <slot#>` |
| View runes | `crd rn` | `crd runes` |
| View rune bags | `crd rb` | `crd rune bag` |

Examples:

```text
crd socket a1b2c3d4 9f8e7d6c 1
crd unsocket a1b2c3d4 1
crd runes
```

Socketing rules:

| Rule | Behaviour |
|---|---|
| Slot must exist on that gear | *"Slot N does not exist on this gear."* |
| Slot must be empty | *"Slot N is already filled. `crd unsocket <id> <slot>` first."* |
| Rune must be unsocketed | *"That rune is already socketed into `<id>`."* |
| Lane must match | Offense runes only in weapons, defense runes only in armor |
| Opposite-lane slots | Currently disabled — *"Opposite rune sockets are disabled for now."* |

Socketing itself is free.

## What does it cost to unsocket a rune

Unsocketing costs Credux and returns the rune to your bag intact, keeping its rolled
value.

<!-- src: src/config/runes.js:108 -->

| Rune tier | Unsocket cost (Credux) |
|---|---|
| Rare | 5,000 |
| Mythic | 15,000 |
| Legendary | 40,000 |
| Supreme | 100,000 |

Existing runes in legacy opposite-lane slots can still be unsocketed, so no rune is ever
trapped.

## How much are runes worth when sold

<!-- src: src/config/runes.js:109 -->

| Rune tier | Sell price (Credux) |
|---|---|
| Rare | 2,000 |
| Mythic | 10,000 |
| Legendary | 40,000 |
| Supreme | 150,000 |

Runes are sold with `crd sell <rune_uid>`. The rune namespace is checked before gear, so
a rune UID resolves to an immediate rune sale.

## How do rune stats combine with everything else

Stat runes are percentage multipliers applied to the class-plus-gear base, before deity
flat stats are added. Precision adds flat CRIT points.

<!-- src: src/engine/statAssembly.js:142 -->

```js
atk  = floor((classAtk + weaponAtk) * (1 + (runeAtkPct + resonanceAtkPct) / 100) + deityAtk)
hp   = floor((classHp  + armorHp)   * (1 + (runeHpPct  + resonanceHpPct)  / 100) + deityHp)
def  = floor((classDef + armorDef)  * (1 + (runeDefPct + resonanceDefPct) / 100) + deityDef)
crit = classCrit + weaponCrit + runeCritPoints + resonanceCritPoints
```

Only runes socketed into your **equipped** weapon and armor count. Runes in unequipped
gear contribute nothing.

## What is the maximum rune loadout

| Slot source | Maximum runes |
|---|---|
| Equipped weapon native sockets | 2 (offense) |
| Equipped armor native sockets | 2 (defense) |
| **Total active runes** | **4** |

Reaching 2 native sockets requires Legendary tier or better gear, which always rolls 2.

## Where can I look up runes I do not own

`crd glossary` has two rune categories — **Offensive Runes** and **Defensive Runes** —
each sorted Supreme down to Rare, showing every rune with its tier and effect.
