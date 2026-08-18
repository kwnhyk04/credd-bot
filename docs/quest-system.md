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

Three distinct quest types per player per day, drawn from a pool of five. Targets are
randomized inside each type's range, and each reward is fixed by that quest's difficulty.

<!-- src: src/utils/questProgress.js:48 -->

| Property | Value |
|---|---|
| Quests per day | 3 |
| Pool size | 5 types |
| Duplicate types in one day | Never |
| Reset | Midnight PHT |
| Rerolls allowed | 2 per day |

## What are the daily quest types and rewards

<!-- src: src/utils/questProgress.js:48 -->

| Quest | Target range | Difficulty | Fixed reward |
|---|---|---|---|
| Win N raids | 3 – 10 | Easy | 30,000 Credux + 500 Shards |
| Defeat N elite mobs | 2 – 5 | Hard | 100,000 Credux + 1,000 Shards |
| Spend N Credux on enhancement | 5,000 – 50,000 | Hard | 100,000 Credux + 1,000 Shards |
| Enhance a weapon N times | 2 – 5 | Hard | 100,000 Credux + 1,000 Shards |
| Have a duel with N users | 2 – 5 | Mid | 50,000 Credux + 750 Shards |

Legacy assigned duel-win and duel-challenge rows remain claimable and use the same Mid
reward, but new boards roll only the unified duel-participation objective.

Rewards are granted automatically the moment a quest reaches its target, with a
completion notice:

```text
📋 Quest complete: Win 7 raids — +30,000 Credux, +500 Shards
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
to zero. Since there are five types and only three in use, a replacement always exists.
The replacement's difficulty reward is recalculated immediately rather than retaining
the previous line's reward.

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
| Win N raids this week | 20 – 40 | 100,000 | 40 | 1 |
| Defeat N elite mobs this week | 15 – 30 | 100,000 | 40 | 1 |
| Spend N Credux on enhancement | 100,000 – 300,000 | 100,000 | 50 | 1 |
| Enhance gear N times this week | 10 – 20 | 100,000 | 40 | 1 |
| Have a duel with N users this week | 5 – 12 | 100,000 | 50 | 1 |

Weekly rewards are fixed per line and do not scale with the rolled target.

Completing all five lines pays a total of 500,000 Credux, 220 Valor, and 5 Sacred Relics,
before the non-relic grand reward.

## What is the weekly grand reward

Clearing all five weekly quests unlocks a one-time bundle for that week.

<!-- src: src/utils/questProgress.js:308 -->

| Reward | Amount |
|---|---|
| Sacred Relic | 0 (the five individual quests grant 5 total) |
| Valor Medals | 200 |
| Credux | 500,000 |

Claim it with the **🏆 Claim Grand Reward** button on the weekly board, or with:

```text
crd quest claim
```

| Condition | Reply |
|---|---|
| Not all five complete | *"⚔️ Finish all 5 weekly quests first — N/5 done."* |
| Already claimed this week | *"✅ You already claimed this week's grand reward."* |
| Success | *"🏆 Weekly full-completion reward claimed: 200 Valor + 500,000 Credux. No additional Sacred Relic was granted."* |

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
| Completed duel | `duel_participations` | `duel_participations` |

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
