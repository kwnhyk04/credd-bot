# Raid System

Raiding is the core solo PvE loop in Credd. `crd raid` spawns one random monster at a
level near your own, resolves the whole fight automatically, and pays Combat EXP, Credux,
Belief Shards and sometimes a chest. `crd auto raid` is a free idle timer that banks the
expected value of grinding raids while you are away. This document covers both, including
every loot range and the exact reward formulas.

Raids are the main source of Combat EXP and the main source of Silver and Gold Chests.

## How do I raid in Credd

| Command | Alias | Slash | Cooldown | Requires |
|---|---|---|---|---|
| `crd raid` | `crd r` | `/raid` | 15 seconds | A character |

The command takes no arguments. Example:

```text
crd raid
```

Flow: a mob spawns, the whole battle is resolved up front by the battle engine, rewards
are committed in one transaction, and only then is the fight animated. Rewards land even
if the Discord animation fails afterwards — the battle result is the source of truth.

You can only have one live battle at a time. Attempting a second raid replies
*"⚔️ You are already in a battle — wait for it to finish."* A battle row older than 5
minutes is treated as crashed and is taken over.

## What monsters can I meet in a raid

Raids spawn one of two categories. Within a category every mob of that type has an equal
chance of appearing.

<!-- src: src/config/raidLoot.js:18 -->

| Category | Spawn chance |
|---|---|
| Regular | 80% |
| Elite | 20% |

Bosses never spawn from `crd raid`; they are a separate scheduled system.

The spawn message differs by category:

| Category | Message |
|---|---|
| Regular | `You ran into the territory of **<name>**...` |
| Elite | `⚠️ You ventured too deep — **<name>** emerges from the shadows...` |

## What level are raid monsters

Mob level is rolled from your own combat level plus a random offset, then clamped.

<!-- src: src/engine/statAssembly.js:225 -->

```js
offset   = uniform integer in [-2, +15]
mobLevel = clamp(playerLevel + offset, 1, 120)
```

| Parameter | Value |
|---|---|
| Minimum offset | −2 |
| Maximum offset | +15 |
| Mean offset | +6.5 |
| Minimum mob level | 1 |
| Maximum mob level | 120 |

<!-- src: src/config/expScaling.js:55 -->

Mob stats scale with that level:

<!-- src: src/engine/statAssembly.js:214 -->

```js
hp   = floor(base_hp  + hp_per_level  * level)
atk  = floor(base_atk + atk_per_level * level)
def  = floor(base_def + def_per_level * level)
crit = base_crit                       // mob CRIT does not scale with level
```

Note the multiplier is `level`, not `level - 1`, and mob CRIT is a flat roster value
that never scales.

## What are the raid loot tables

All ranges are inclusive. EXP is then multiplied by the level-scaling factor; Credux,
Shards and the chest roll are **not** scaled.

<!-- src: src/config/raidLoot.js:20 -->

Regular mob:

| Outcome | Credux | Combat EXP (base) | Belief Shards | Chest |
|---|---|---|---|---|
| Win | 500–1,000 | 200–300 | 5–10 (100% chance) | 10% chance of 1 Silver Chest |
| Loss | 0 | 50 | 0 | none |

Elite mob:

| Outcome | Credux | Combat EXP (base) | Belief Shards | Chest |
|---|---|---|---|---|
| Win | 1,500–2,000 | 400–600 | 15–20 (100% chance) | 20% chance of 1 Gold Chest |
| Loss | 0 | 150 | 0 | none |

Belief Shards drop on every win — `shardChance` is 1.0 for both categories. Only the
chest roll is chance-based.

## How much EXP does a raid actually pay

The base EXP from the table above is multiplied by the mob's level scaling factor.

<!-- src: src/config/expScaling.js:76 -->

```js
multiplier = max(1.0, (clamp(mobLevel, 1, 120) / 30) ** 2)
finalExp   = round(baseExp * multiplier)
```

| Mob level | Multiplier | Regular win (200–300) | Elite win (400–600) |
|---|---|---|---|
| 1–30 | 1.00 | 200–300 | 400–600 |
| 40 | 1.78 | 356–533 | 711–1,067 |
| 50 | 2.78 | 556–833 | 1,111–1,667 |
| 60 | 4.00 | 800–1,200 | 1,600–2,400 |
| 80 | 7.11 | 1,422–2,133 | 2,844–4,267 |
| 100 | 11.11 | 2,222–3,333 | 4,444–6,667 |
| 120 | 16.00 | 3,200–4,800 | 6,400–9,600 |

Losses are scaled the same way, so a level-100 loss against a level-100 mob still pays
meaningfully (50 × 11.11 ≈ 556 EXP for a regular mob).

## What does a raid progress toward besides loot

Raid results feed several other systems in the same transaction:

| System | Effect |
|---|---|
| Combat level | EXP applied, level-ups and their rewards granted immediately |
| Win/loss record | `raids_won` or `raids_lost` incremented |
| Daily quests | A win progresses `raid_wins`; an elite win also progresses `elite_defeats` |
| Weekly quests | The same deltas progress the weekly `raid_wins` and `elite_defeats` lines |
| Leaderboards | Feeds "Raids Done" and "Raid Wins" boards |
| Lifetime Credux | Credux earned adds to `lifetime_credux_earned` |

Duel and ranked results do **not** progress raid quests.

## What is auto raid and how does it work

`crd auto raid` is a free, no-loss idle timer. You start it, walk away, and claim a
deterministic expected payout when it finishes. It never loses, never blocks a manual
`crd raid`, and can be restarted the moment the previous run is claimed.

| Command | Alias | Slash | Cooldown | Requires |
|---|---|---|---|---|
| `crd auto raid` | `crd ar` | Not available (prefix only) | 10 seconds | A character |

Example:

```text
crd auto raid
```

The command shows one of three cards depending on your state:

| State | Card | Action |
|---|---|---|
| No run active | Start card | **Start Auto Raid** button |
| Run active, not finished | Progress card | No button; shows time remaining |
| Run finished | Claim card | **Claim Rewards** button |

## How long does an auto raid run for

The window length is set from the combat level snapshotted when you press Start. Levelling
up mid-run does not change the payout.

<!-- src: src/commands/rpg/autoRaid.js:40 -->

```js
windowSeconds = max(1, combatLevel) * 30 * 60      // 30 minutes per combat level
virtualRaids  = floor(windowSeconds / 60)          // one virtual raid per 60 seconds
```

| Combat level | Window length | Virtual raids |
|---|---|---|
| 1 | 30 minutes | 30 |
| 10 | 5 hours | 300 |
| 30 | 15 hours | 900 |
| 50 | 25 hours | 1,500 |
| 100 | 50 hours | 3,000 |

## How are auto raid rewards calculated

Auto raid pays a deterministic expected value: it assumes every virtual raid is a win,
splits them 80% regular / 20% elite, averages each loot range, then applies a per-reward
scale-down so manual raiding stays the faster path.

<!-- src: src/commands/rpg/autoRaid.js:64 -->

```js
raids      = floor(windowSeconds / 60)
eliteRaids = round(raids * 0.20)
regRaids   = raids - eliteRaids

exp    = scaleExpForMobLevel(
           round((regRaids * avg(200,300) + eliteRaids * avg(400,600)) * 0.5),
           expectedMobLevelFor(level))
credux = round((regRaids * avg(500,1000) + eliteRaids * avg(1500,2000)) * 0.5)
shards = round((regRaids * avg(5,10) * 1.0 + eliteRaids * avg(15,20) * 1.0) * 0.2)
```

| Reward | Scale of expected raid yield |
|---|---|
| Combat EXP | 50% |
| Credux | 50% |
| Belief Shards | 20% |
| Chests | 0% — auto raid never grants chests |

The EXP scaling level is the **expected** mob level for your combat level:

<!-- src: src/config/expScaling.js:100 -->

```js
expectedMobLevel = clamp(round(playerLevel + 6.5), 1, 120)
```

Worked payouts:

| Combat level | Window | Combat EXP | Credux | Belief Shards |
|---|---|---|---|---|
| 1 | 30 min | 4,500 | 14,250 | 57 |
| 10 | 5 h | 45,000 | 142,500 | 570 |
| 30 | 15 h | 205,350 | 427,500 | 1,710 |
| 50 | 25 h | 812,250 | 712,500 | 2,850 |
| 100 | 50 h | 5,724,500 | 1,425,000 | 5,700 |

## Can I raid manually while an auto raid is running

Yes. Auto raid uses its own state table and does not occupy the live-battle slot, so
`crd raid` works normally while an auto raid is counting down.

Claiming before the timer ends is rejected with the remaining time. Only the owner of the
run can press the Start or Claim buttons.

## What is the difference between raid and auto raid

| Property | `crd raid` | `crd auto raid` |
|---|---|---|
| Can lose | Yes | No — always pays a win-based expectation |
| Chests | Yes (Silver 10% / Gold 20%) | No |
| Rewards per real-world hour | Higher | Lower (50% EXP/Credux, 20% Shards) |
| Quest progress | Yes | No |
| Requires attention | Yes, one command per fight | No |
| Cooldown | 15 seconds per raid | 10 seconds on the command; one run at a time |
| Cost | Free | Free |

Auto raid is a catch-up and offline mechanism, not a replacement for raiding.
