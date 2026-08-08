# Quest System

Credd has two quest boards. **Daily quests** are three randomly rolled objectives that
reset at midnight PHT and pay Credux and Belief Shards. Completing the full daily set
also grants exactly **+1 Sacred Relic** once per day. **Weekly quests** are five fixed
objectives that reset on Monday and pay Credux, Valor Medals, and **+1 Sacred Relic per
quest**. The weekly full-completion bonus grants no additional Sacred Relic.

Quest progress is credited automatically as you play — there is nothing to turn in
except the weekly grand reward.

## How do I view my quests

<!-- src: src/commands/economy/quests.js:251 -->

| Command | Alias | Slash | Shows |
|---|---|---|---|
| `crd quests` | `crd q` | `/quests` | The daily board |
| `crd quest weekly` | `crd q weekly` | Not available | The weekly board |
| `crd quest refresh <Q1\|Q2\|Q3>` | — | Not available | Rerolls one daily line |
| `crd quest claim` | — | Not available | Claims the weekly grand reward |

Both `crd quest` and `crd quests` work. A Daily/Weekly dropdown in the header switches
boards in place, and each board is rolled lazily the first time you view it.

Examples:

```text
crd quests
crd quest weekly
crd quest refresh Q2
crd quest claim
```

## How many daily quests do I get

Three distinct quest types per player per day, drawn from a pool of six. Targets are
randomized inside each type's range, and the reward is fixed at roll time based on the
rolled target.

<!-- src: src/utils/questProgress.js:48 -->

| Property | Value |
|---|---|
| Quests per day | 3 |
| Pool size | 6 types |
| Duplicate types in one day | Never |
| Reset | Midnight PHT |
| Rerolls allowed | 2 per day |

## What are the daily quest types and rewards

<!-- src: src/utils/questProgress.js:48 -->

| Quest | Target range | Reward tiers |
|---|---|---|
| Win N raids | 3 – 10 | 3–5 → 3,000 Credux + 5 Shards · 6–8 → 6,000 + 10 · 9–10 → 10,000 + 15 |
| Defeat N elite mobs | 2 – 5 | 2–3 → 5,000 Credux + 8 Shards · 4–5 → 10,000 + 15 |
| Spend N Credux on enhancement | 5,000 – 50,000 | ≤20,000 → 4,000 Credux + 5 Shards · >20,000 → 9,000 + 12 |
| Enhance a weapon N times | 2 – 5 | 2–3 → 4,000 Credux + 5 Shards · 4–5 → 8,000 + 10 |
| Win N duels | 1 – 3 | 1 → 5,000 Credux + 8 Shards · 2–3 → 12,000 + 18 |
| Challenge N players to a duel | 2 – 5 | 2–3 → 3,000 Credux + 5 Shards · 4–5 → 6,000 + 10 |

Rewards are granted automatically the moment a quest reaches its target, with a
completion notice:

```text
📋 Quest complete: Win 7 raids — +6,000 Credux, +10 Shards
```

When the third daily quest completes, the board also reports:

```text
Daily Quest Completion Bonus: +1 Sacred Relic
```

## How do I reroll a daily quest

<!-- src: src/utils/questProgress.js:36 -->

| Property | Value |
|---|---|
| Refreshes per day | 2 |
| Reset | Midnight PHT |
| Syntax | `crd quest refresh <Q1\|Q2\|Q3>` |

A reroll replaces that line with a quest type not currently in use and resets its progress
to zero. Since there are six types and only three in use, a replacement always exists.

Failure messages:

| Condition | Reply |
|---|---|
| Allowance used up | *"You've used all 2 quest refreshes today. They reset at midnight PHT."* |
| Bad slot | *"No quest in that slot — pick `Q1`, `Q2`, or `Q3`."* |

## How many weekly quests are there

Five fixed lines every PHT week. Unlike daily quests, the five types never change — only
their targets are rolled.

<!-- src: src/utils/questProgress.js:300 -->

| Property | Value |
|---|---|
| Quests per week | 5 (always the same five types) |
| Reset | Monday 00:00 PHT (ISO week) |
| Rerolls | Not available |
| Reward currencies | Credux, Valor Medals, and 1 Sacred Relic per completed quest |

## What are the weekly quest targets and rewards

<!-- src: src/utils/questProgress.js:300 -->

| Quest | Target range | Credux | Valor | Sacred Relic |
|---|---|---|---|---|
| Win N raids this week | 20 – 40 | 20,000 | 40 | 1 |
| Defeat N elite mobs this week | 15 – 30 | 20,000 | 40 | 1 |
| Spend N Credux on enhancement | 100,000 – 300,000 | 25,000 | 50 | 1 |
| Enhance gear N times this week | 10 – 20 | 20,000 | 40 | 1 |
| Win N duels this week | 5 – 12 | 25,000 | 50 | 1 |

Weekly rewards are fixed per line and do not scale with the rolled target.

Completing all five lines pays a total of 110,000 Credux, 220 Valor, and 5 Sacred Relics,
before the non-relic grand reward.

## What is the weekly grand reward

Clearing all five weekly quests unlocks a one-time bundle for that week.

<!-- src: src/utils/questProgress.js:308 -->

| Reward | Amount |
|---|---|
| Sacred Relic | 0 (the five individual quests grant 5 total) |
| Valor Medals | 150 |
| Credux | 50,000 |

Claim it with the **🏆 Claim Grand Reward** button on the weekly board, or with:

```text
crd quest claim
```

| Condition | Reply |
|---|---|
| Not all five complete | *"⚔️ Finish all 5 weekly quests first — N/5 done."* |
| Already claimed this week | *"✅ You already claimed this week's grand reward."* |
| Success | *"🏆 Weekly full-completion reward claimed: 150 Valor + 50,000 Credux. No additional Sacred Relic was granted."* |

The claim is guarded so it can only ever pay once per player per week.

## Which actions progress which quests

The same progress deltas feed both boards, so playing normally advances daily and weekly
lines together.

<!-- src: src/utils/questProgress.js:197 -->

| Action | Daily quest progressed | Weekly quest progressed |
|---|---|---|
| Raid win | `raid_wins` | `raid_wins` |
| Raid win against an elite mob | `raid_wins` and `elite_defeats` | `raid_wins` and `elite_defeats` |
| Enhancement attempt (success or failure) | `credux_spent` and `weapon_enhancements` | `credux_spent` and `weapon_enhancements` |
| Duel win | `duel_wins` | `duel_wins` |
| Issuing a duel challenge | `duel_challenges` | — (no weekly line) |

Auto raid, ranked matches, boss attacks and casino games do **not** progress quests.

## When do quest boards reset

<!-- src: src/schedulers/resetScheduler.js:56 -->

| Board | Reset | Behaviour |
|---|---|---|
| Daily | Midnight PHT | Old quests are deleted and a fresh set of 3 is rolled for every player |
| Weekly | Monday 00:00 PHT | A new week bucket rolls a fresh set of 5 on first view |
| Refresh allowance | Midnight PHT | Returns to 2 |

If the scheduled roll is missed for any reason, the board rolls lazily the first time you
open it, so you never lose a day of quests.

## Can I lose quest progress

No. Progress is clamped at the target and a completed quest stays completed until the
board resets. A reroll resets only the rerolled line, and only that line's progress.
