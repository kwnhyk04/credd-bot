# Progression & Leveling System

Credd has two independent level tracks. **Combat Level** is earned by fighting and
determines your class stats; it is capped at 100. **Believer Level** is earned by using
commands and summoning, is uncapped, and unlocks deity slots and titles. This document
gives the full EXP curves, the level-up reward tables, and how EXP scales with the level
of what you fought.

Both tracks are shown on `crd profile` (Believer) and `crd stats` (Combat).

## What is the maximum combat level in Credd

The combat level cap is **100**.

<!-- src: src/config/combatExp.js:39 -->

Total EXP required to reach level 100 from level 1 is **3,630,601,650**.

Level and within-level EXP are a derived cache over `user_character.lifetime_exp`, which
is the source of truth for total EXP ever earned. EXP earned at the cap keeps
accumulating inside level 100 but never levels past it.

## How much EXP does each combat level need

`EXP to next` is the cost of moving from that level to the next one. `Total EXP` is the
lifetime EXP at which you arrive at the next level with an empty bar.

<!-- src: src/config/combatExp.js:42 -->

Levels 1–50 (authored values):

| Level | EXP to next | Total EXP |
|---|---|---|
| 1 → 2 | 100 | 100 |
| 2 → 3 | 250 | 350 |
| 3 → 4 | 500 | 850 |
| 4 → 5 | 1,000 | 1,850 |
| 5 → 6 | 1,800 | 3,650 |
| 6 → 7 | 3,000 | 6,650 |
| 7 → 8 | 5,000 | 11,650 |
| 8 → 9 | 8,000 | 19,650 |
| 9 → 10 | 12,000 | 31,650 |
| 10 → 11 | 20,000 | 51,650 |
| 11 → 12 | 30,000 | 81,650 |
| 12 → 13 | 45,000 | 126,650 |
| 13 → 14 | 65,000 | 191,650 |
| 14 → 15 | 95,000 | 286,650 |
| 15 → 16 | 140,000 | 426,650 |
| 16 → 17 | 200,000 | 626,650 |
| 17 → 18 | 290,000 | 916,650 |
| 18 → 19 | 420,000 | 1,336,650 |
| 19 → 20 | 600,000 | 1,936,650 |
| 20 → 21 | 700,000 | 2,636,650 |
| 21 → 22 | 745,000 | 3,381,650 |
| 22 → 23 | 790,000 | 4,171,650 |
| 23 → 24 | 840,000 | 5,011,650 |
| 24 → 25 | 895,000 | 5,906,650 |
| 25 → 26 | 950,000 | 6,856,650 |
| 26 → 27 | 1,010,000 | 7,866,650 |
| 27 → 28 | 1,075,000 | 8,941,650 |
| 28 → 29 | 1,145,000 | 10,086,650 |
| 29 → 30 | 1,215,000 | 11,301,650 |
| 30 → 31 | 1,300,000 | 12,601,650 |
| 31 → 32 | 2,100,000 | 14,701,650 |
| 32 → 33 | 3,300,000 | 18,001,650 |
| 33 → 34 | 4,600,000 | 22,601,650 |
| 34 → 35 | 6,000,000 | 28,601,650 |
| 35 → 36 | 7,500,000 | 36,101,650 |
| 36 → 37 | 9,100,000 | 45,201,650 |
| 37 → 38 | 10,800,000 | 56,001,650 |
| 38 → 39 | 12,600,000 | 68,601,650 |
| 39 → 40 | 14,500,000 | 83,101,650 |
| 40 → 41 | 16,500,000 | 99,601,650 |
| 41 → 42 | 18,600,000 | 118,201,650 |
| 42 → 43 | 20,800,000 | 139,001,650 |
| 43 → 44 | 23,100,000 | 162,101,650 |
| 44 → 45 | 25,500,000 | 187,601,650 |
| 45 → 46 | 28,000,000 | 215,601,650 |
| 46 → 47 | 30,600,000 | 246,201,650 |
| 47 → 48 | 33,300,000 | 279,501,650 |
| 48 → 49 | 36,100,000 | 315,601,650 |
| 49 → 50 | 39,000,000 | 354,601,650 |
| 50 → 51 | 42,000,000 | 396,601,650 |

Levels 51–99 are generated, not authored:

<!-- src: src/config/combatExp.js:53 -->

```js
EXP_TO_NEXT[level] = 42_000_000 + 1_000_000 * (level - 51)   // for level 51..99
```

| Level | EXP to next | Total EXP |
|---|---|---|
| 51 → 52 | 42,000,000 | 438,601,650 |
| 52 → 53 | 43,000,000 | 481,601,650 |
| 53 → 54 | 44,000,000 | 525,601,650 |
| 54 → 55 | 45,000,000 | 570,601,650 |
| 55 → 56 | 46,000,000 | 616,601,650 |
| 56 → 57 | 47,000,000 | 663,601,650 |
| 57 → 58 | 48,000,000 | 711,601,650 |
| 58 → 59 | 49,000,000 | 760,601,650 |
| 59 → 60 | 50,000,000 | 810,601,650 |
| 60 → 61 | 51,000,000 | 861,601,650 |
| 61 → 62 | 52,000,000 | 913,601,650 |
| 62 → 63 | 53,000,000 | 966,601,650 |
| 63 → 64 | 54,000,000 | 1,020,601,650 |
| 64 → 65 | 55,000,000 | 1,075,601,650 |
| 65 → 66 | 56,000,000 | 1,131,601,650 |
| 66 → 67 | 57,000,000 | 1,188,601,650 |
| 67 → 68 | 58,000,000 | 1,246,601,650 |
| 68 → 69 | 59,000,000 | 1,305,601,650 |
| 69 → 70 | 60,000,000 | 1,365,601,650 |
| 70 → 71 | 61,000,000 | 1,426,601,650 |
| 71 → 72 | 62,000,000 | 1,488,601,650 |
| 72 → 73 | 63,000,000 | 1,551,601,650 |
| 73 → 74 | 64,000,000 | 1,615,601,650 |
| 74 → 75 | 65,000,000 | 1,680,601,650 |
| 75 → 76 | 66,000,000 | 1,746,601,650 |
| 76 → 77 | 67,000,000 | 1,813,601,650 |
| 77 → 78 | 68,000,000 | 1,881,601,650 |
| 78 → 79 | 69,000,000 | 1,950,601,650 |
| 79 → 80 | 70,000,000 | 2,020,601,650 |
| 80 → 81 | 71,000,000 | 2,091,601,650 |
| 81 → 82 | 72,000,000 | 2,163,601,650 |
| 82 → 83 | 73,000,000 | 2,236,601,650 |
| 83 → 84 | 74,000,000 | 2,310,601,650 |
| 84 → 85 | 75,000,000 | 2,385,601,650 |
| 85 → 86 | 76,000,000 | 2,461,601,650 |
| 86 → 87 | 77,000,000 | 2,538,601,650 |
| 87 → 88 | 78,000,000 | 2,616,601,650 |
| 88 → 89 | 79,000,000 | 2,695,601,650 |
| 89 → 90 | 80,000,000 | 2,775,601,650 |
| 90 → 91 | 81,000,000 | 2,856,601,650 |
| 91 → 92 | 82,000,000 | 2,938,601,650 |
| 92 → 93 | 83,000,000 | 3,021,601,650 |
| 93 → 94 | 84,000,000 | 3,105,601,650 |
| 94 → 95 | 85,000,000 | 3,190,601,650 |
| 95 → 96 | 86,000,000 | 3,276,601,650 |
| 96 → 97 | 87,000,000 | 3,363,601,650 |
| 97 → 98 | 88,000,000 | 3,451,601,650 |
| 98 → 99 | 89,000,000 | 3,540,601,650 |
| 99 → 100 | 90,000,000 | 3,630,601,650 |

Levels 50 and 51 both cost 42,000,000 — that single plateau is intentional. The tail
rises rather than staying flat because EXP rewards scale quadratically with enemy level,
so a flat tail would make the endgame accelerate instead of slow down.

## How does EXP scale with the level of what I fight

Every EXP payout is multiplied by a scaling factor derived from the level of the thing
that produced it. The multiplier is exactly 1.0 at level 30 and never drops below 1.0.

<!-- src: src/config/expScaling.js:76 -->

```js
level      = clamp(floor(levelForScaling), 1, 120)
multiplier = max(1.0, (level / 30) ** 2)
scaledExp  = round(baseExp * multiplier)
```

| Parameter | Value | Meaning |
|---|---|---|
| Pivot level | 30 | The level where the multiplier is exactly 1.0 |
| Exponent | 2 | Quadratic scaling |
| Floor | 1.0 | No payout is ever smaller than the unscaled value |
| Minimum level | 1 | Clamp lower bound |
| Maximum level | 120 | Clamp upper bound, caps reward inflation |

Resulting multipliers:

| Enemy / participant level | Multiplier |
|---|---|
| 1–30 | 1.00 (floor) |
| 40 | 1.78 |
| 50 | 2.78 |
| 60 | 4.00 |
| 75 | 6.25 |
| 90 | 9.00 |
| 100 | 11.11 |
| 115 | 14.69 |
| 120 and above | 16.00 (clamped) |

**Which level is used depends on the source:**

| EXP source | Scales on |
|---|---|
| Manual raid (`crd raid`) | The mob's level |
| Auto raid (`crd auto raid`) | The expected mob level for your level (your level + 6.5, rounded) |
| Boss participation | The attacking player's **own** combat level, never the boss's |

Boss EXP deliberately scales on the participant's own level because boss level is the
average combat level of active players — scaling on the boss would let a low-level
participant in a high-level fight out-earn every level they had gained so far.

Only EXP is scaled. Credux, Belief Shards and chest rolls never inherit the multiplier.
Raid losses are scaled too, so loss payouts do not decay toward worthless at high level.

## What rewards do I get for a combat level-up

Combat level-ups grant Credux and chests from a bracket table. Level 1 is the starting
level and is never rewarded, so rewards begin at level 2. Levels above 50 currently grant
nothing.

<!-- src: src/config/levelRewards.js:37 -->

| Combat levels | Credux per level | Chests per level |
|---|---|---|
| 2–10 | 100,000 | 1 Gold Chest |
| 11–20 | 250,000 | 1 Boss Treasure Chest |
| 21–30 | 500,000 | 2 Boss Treasure Chests |
| 31–40 | 1,000,000 | 3 Boss Treasure Chests |
| 41–50 | 5,000,000 | 1 Boss Golden Chest |
| 51–100 | 0 | none |

Rewards are granted per level, not per bracket. Jumping from level 19 to level 22 in one
payout grants the level 20, 21 and 22 rewards separately.

Each level's reward is granted exactly once, tracked in a dedicated table, so a level can
never be paid twice.

## What is Believer Level and how do I raise it

Believer Level is the account-wide devotion track. It is uncapped and rises on a flat
curve: every Believer Level costs the same amount of reputation EXP.

<!-- src: src/config/believerProgression.js:3 -->

| Property | Value |
|---|---|
| EXP per Believer Level | 3,000 (flat, every level) |
| Daily reputation EXP cap | 1,500 per PHT day |
| EXP per command | 3 |
| EXP per summon pull | 10 |
| Cap | None |

<!-- src: src/utils/awardBelieverExp.js:11 -->
<!-- src: src/config/gachaRates.js:63 -->

Every Credd command awards 3 reputation EXP, except `crd summon` and relic opens
(`crd open sr` / `crd open supr`), which award 10 per pull through the summon path
instead. The daily cap of 1,500 reputation EXP is shared across all sources and resets at
midnight PHT (Asia/Manila, UTC+8).

At 1,500 EXP per day the fastest possible pace is one Believer Level every two days.

## What are the Believer titles and level gates

Believer Level unlocks display titles and the second and third deity slots.

<!-- src: src/config/believerProgression.js:5 -->

| Believer Level | Title |
|---|---|
| 1 | Wanderer |
| 10 | Devotee |
| 25 | Disciple |
| 50 | Zealot |
| 100 | Champion of Faith |
| 200 | Chosen One |
| 500 | Last Believer |

<!-- src: src/config/blessings.js:50 -->

| Unlock | Requirement |
|---|---|
| Deity slot 2 | Believer Level 15 |
| Deity slot 3 | Believer Level 30 |

Titles are granted automatically and idempotently as the level rises; every title at or
below your level is owned. Equip one with `crd title equip <name>`.

## What rewards do I get for a Believer level-up

Believer level-ups pay a separate, larger bracket table. Rewards start at level 2 and
stop after level 50.

<!-- src: src/config/levelRewards.js:45 -->

| Believer levels | Credux per level | Chests per level |
|---|---|---|
| 2–10 | 250,000 | 5 Gold Chests |
| 11–20 | 500,000 | 5 Boss Treasure Chests |
| 21–30 | 1,000,000 | 10 Boss Treasure Chests |
| 31–50 | 1,000,000 | 5 Boss Golden Chests |
| 51 and above | 0 | none |

A level-up posts a notice like:

```text
📿 Believer Level 12 → 13!
🎁 Level Rewards: +500,000 Credux · +5 Boss Treasure Chests
```

## Which activities give combat EXP

| Activity | Base EXP | Scaled by |
|---|---|---|
| Raid win vs regular mob | 200–300 | Mob level |
| Raid win vs elite mob | 400–600 | Mob level |
| Raid loss vs regular mob | 50 | Mob level |
| Raid loss vs elite mob | 150 | Mob level |
| Auto raid claim | Expected value of the window | Expected mob level |
| Normal boss defeat (all attackers) | 20,000 | Attacker's own level |
| Greater Boss — Twin Chest variant | 30,000 | Attacker's own level |
| Greater Boss — Golden Chest variant | 40,000 | Attacker's own level |

<!-- src: src/config/raidLoot.js:20 -->
<!-- src: src/config/bosses.js:31 -->

Duels and ranked PvP grant **no** combat EXP. Casino games grant no combat EXP.

## Which activities give reputation (Believer) EXP

| Activity | Reputation EXP |
|---|---|
| Any Credd command | 3 |
| Each summon pull (`crd summon`) | 10 |
| Each pull from a Sacred Relic (30 pulls) | 10 per pull, 300 total before the daily cap |
| Each pull from a Supreme Relic (1 pull) | 10 |

All of these share the 1,500/day PHT cap. Once the cap is reached further activity
awards 0 until midnight PHT.
