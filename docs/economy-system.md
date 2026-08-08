# Economy & Currency System

Credd runs on four player-facing currencies plus several item currencies. This document
covers what each currency is for, where it comes from, where it goes, the daily
attendance reward, and the player-to-player Credux transfer rules.

All daily and weekly resets in Credd run on Philippine Time (PHT, Asia/Manila, UTC+8,
no daylight saving).

## What currencies exist in Credd

| Currency | Type | Primary use |
|---|---|---|
| **Credux** | Earned currency | Enhancement, shops, unsocketing, wagers, casino |
| **Belief Shards** | Earned currency | The deity gacha — 100 shards per pull |
| **Valor Medals** | PvP currency | The PvP Shop only |
| **Essence** (Epic / Mythic / Legendary / Supreme) | Item currency | Sigils, Ascension, deity enhancement, rune bags |
| **Sacred Relic** | Ticket item | 10 deity pulls |
| **Supreme Relic** | Ticket item | 1 forced Supreme deity pull |
| **Supporter tokens** | Cosmetic currency | Skins and avatars only — never gameplay |

Credux has no real-world value and cannot be traded for anything outside the game.

## How do I check my balance

| Command | Alias | Slash | Requires a character |
|---|---|---|---|
| `crd cred` | `crd g` | `/cred` | No |

Example:

```text
crd cred
```

`crd bag` shows every other currency and item.

## Where does Credux come from

| Source | Amount |
|---|---|
| Raid win vs regular mob | 500 – 1,000 |
| Raid win vs elite mob | 1,500 – 2,000 |
| Auto raid claim | 50% of the expected raid value for the window |
| Normal boss defeat | 100,000 |
| Greater Boss — Twin Chest | 150,000 |
| Greater Boss — Golden Chest | 200,000 |
| Daily attendance | 1,000 – 25,000 by streak day |
| Daily quest completion | 3,000 – 12,000 per quest |
| Weekly quest completion | 20,000 – 25,000 per quest |
| Weekly quest grand reward | 50,000 |
| Combat level-up | 100,000 – 5,000,000 by bracket |
| Believer level-up | 250,000 – 1,000,000 by bracket |
| Ranked weekly claim | By bracket |
| Selling gear and runes | By tier |
| Casino wins | By game and stake |
| Bestow from another player | Up to the receiver's daily cap |

<!-- src: src/config/raidLoot.js:20 -->

## Where does Credux go

| Sink | Cost |
|---|---|
| Weapon and armor enhancement | 1,000 – 3,000,000 per attempt, charged on failure too |
| CRD Shop | 5,000 – 5,000,000 per item |
| Essence shop rune bags | 50,000 – 250,000 plus essence |
| Essence tier conversion | 50,000 – 250,000 per conversion |
| Unsocketing a rune | 5,000 – 100,000 by rune tier |
| Deity Ascension | 100,000 – 1,000,000 by tier |
| Wager duels | Up to 50,000 per duel |
| Casino wagers | Up to 500,000 per bet |

Enhancement is by far the largest sink because Credux is spent on failed attempts as well
as successful ones.

## How does the daily reward work

`crd daily` pays Credux, Belief Shards and one chest, scaled by your position in a
30-day monthly cycle.

| Command | Alias | Slash | Requires a character |
|---|---|---|---|
| `crd daily` | — | `/daily` | No |

Example:

```text
crd daily
```

Two streaks are tracked:

<!-- src: src/commands/economy/daily.js:5 -->

| Streak | Behaviour |
|---|---|
| Monthly streak | Cycles 1 to 30 and wraps back to 1 |
| Overall streak | Lifetime consecutive days, no wrap |

Claiming on a consecutive day advances both. Missing a day resets **both** to day 1.
Claiming twice in one PHT day replies *"⏳ You already claimed today (Day N). Come back
after midnight PHT."*

## What are the daily attendance rewards

<!-- src: src/commands/economy/daily.js:72 -->

| Monthly day | Credux | Belief Shards | Chest |
|---|---|---|---|
| 1 – 6 | 1,000 | 3 | Silver Chest |
| 7 | 5,000 | 10 | **Gold Chest** |
| 8 – 13 | 2,000 | 5 | Silver Chest |
| 14 | 8,000 | 15 | **Gold Chest** |
| 15 – 20 | 3,000 | 8 | Silver Chest |
| 21 | 12,000 | 20 | **Gold Chest** |
| 22 – 27 | 4,000 | 10 | Silver Chest |
| 28 | 15,000 | 25 | **Gold Chest** |
| 29 | 18,000 | 28 | **Gold Chest** |
| 30 | 25,000 | 35 | **Gold Chest** |

Gold Chest days are 7, 14, 21, 28, 29 and 30. Every other day gives a Silver Chest.

A perfect 30-day cycle totals 96,000 Credux, 244 Belief Shards, 24 Silver Chests and
6 Gold Chests.

## How do I send Credux to another player

`crd bestow` transfers Credux with a confirmation step. Balances are never displayed.

| Command | Alias | Slash | Cooldown |
|---|---|---|---|
| `crd bestow @user <amount>` | `crd bs @user <amount>` | `/bestow user: amount:` | 10 seconds |

Example:

```text
crd bestow @Friend 250000
```

The sender gets a confirm card with a 60-second window. Only the sender can press
Confirm or Cancel. Both the balance and the receiver's cap are re-validated inside the
transaction, so a stale card can never over-send.

## What is the daily bestow cap

The cap is **receiver-side** and scales with the receiver's levels.

<!-- src: src/config/bestow.js:14 -->

```js
dailyCap = 1_000_000
         + believerLevel * 500_000
         + combatLevel   * 500_000
```

| Component | Value |
|---|---|
| Base cap | 1,000,000 Credux per day |
| Per receiver Believer Level | +500,000 |
| Per receiver Combat Level | +500,000 |

Worked examples:

| Receiver | Daily cap |
|---|---|
| Believer 1, Combat 1 | 2,000,000 |
| Believer 10, Combat 20 | 16,000,000 |
| Believer 50, Combat 50 | 51,000,000 |

Partial fills are **not** allowed. If the amount would exceed the receiver's remaining
headroom the whole bestow is rejected and the reply states the requested amount, the
daily limit, the remaining headroom, the receiver's levels, and the exact reset time.

The cap resets at midnight PHT. Wager duel winnings count against the same cap.

## Is real-money trading allowed

No. Every bestow confirmation carries this warning:

> ⚠️ **Bestowing Credux in exchange for real money, gift cards, or anything of real-world
> value is strictly prohibited.** Real-money trading (RMT) in any form will result in a
> permanent ban for all accounts involved.

## Where do Belief Shards come from

| Source | Amount |
|---|---|
| Character creation | 1,000 |
| Raid win vs regular mob | 5 – 10 (always drops) |
| Raid win vs elite mob | 15 – 20 (always drops) |
| Auto raid claim | 20% of the expected raid value |
| Normal boss defeat | 1,000 |
| Greater Boss — Twin Chest | 1,500 |
| Greater Boss — Golden Chest | 2,000 |
| Daily attendance | 3 – 35 by streak day |
| Daily quest completion | 5 – 18 per quest |

Belief Shards have exactly one sink: `crd summon`, at 100 shards per pull.

## Where does essence come from

Essence comes only from duplicate deity pulls and from converting a lower tier upward.

| Source | Amount |
|---|---|
| Duplicate Epic deity | +1 Epic Essence |
| Duplicate Mythic deity | +2 Mythic Essence |
| Duplicate Legendary deity | +5 Legendary Essence |
| Duplicate Supreme deity | +10 Supreme Essence |
| `crd exchange essence` | 10 of the lower tier + Credux → 1 of the target tier |

Essence sinks are Sigils, Ascension, deity enhancement and essence-shop rune bags.

## Where do Valor Medals come from

| Source | Amount |
|---|---|
| Ranked win | 10 – 20 in season |
| Ranked loss | 3 – 8 in season |
| Weekly quest completion | 40 – 50 per quest |
| Weekly quest grand reward | 150 |
| Ranked weekly claim | By bracket |
| Season-end payout | By peak bracket |

Valor has exactly one sink: the PvP Shop. No Valor is paid outside an active season for
ranked matches.

## When do daily and weekly things reset

<!-- src: src/schedulers/resetScheduler.js:24 -->

| Reset | When |
|---|---|
| Daily attendance | Midnight PHT |
| Daily quests | Midnight PHT — old quests are deleted and re-rolled |
| Quest refresh allowance | Midnight PHT |
| Reputation EXP daily cap | Midnight PHT |
| Bestow received counter | Midnight PHT |
| Boss attack limit | Midnight PHT |
| Weekly quests | Monday 00:00 PHT |
| Ranked weekly claim | Monday 00:00 PHT (ISO week) |
| CRD Shop daily limits | Midnight PHT |
| CRD Shop weekly limits | Monday 00:00 PHT |
| CRD Shop monthly limits | 1st of the month, 00:00 PHT |
| PvP Shop caps | On season change, not on a clock |
