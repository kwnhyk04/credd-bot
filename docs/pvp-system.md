# PvP System

Credd has two separate player-versus-player modes. **Duels** are friendly, consent-based
fights that pay nothing (or an agreed Credux stake). **Ranked** is an Elo-rated ladder
against auto-matched opponent snapshots that pays rating and Valor Medals. This document
covers both, plus brackets, seasons, weekly claims and leaderboards.

Neither mode grants Combat EXP. Ranked is the only source of PvP rating and the main
source of Valor Medals.

## How do I duel another player

| Command | Alias | Slash | Cooldown | Requires |
|---|---|---|---|---|
| `crd duel @user` | `crd d @user` | `/duel user: [level:]` | 15 seconds | A character |
| `crd duel @user level <N>` | `crd d @user level 50` | `/duel user: level:` | 15 seconds | A character |
| `crd duel wager @user <amount>` | — | Not available (prefix only) | 15 seconds | A character |

Examples:

```text
crd duel @Friend
crd duel @Friend level 30
crd duel wager @Friend 10000
```

The challenged player gets an Accept / Decline card with a **60-second** window. Only
that player can press the buttons. Loadouts are read at Accept time, not at challenge
time.

<!-- src: src/commands/rpg/duel.js:40 -->

## What are the rules and rewards of a casual duel

Casual duels are purely friendly. They exist for bragging rights and quest progress.

<!-- src: src/commands/rpg/duel.js:11 -->

| Property | Value |
|---|---|
| Combat EXP | None |
| Credux | None |
| Item drops | None |
| PvP rating change | None |
| Challenge window | 60 seconds |
| Battle state | In-memory; no active battle row is created |
| Engine mode | `duel` — both sides run weapon and deity passives, instakill disabled, 50/50 first-attack roll |

What a duel *does* write:

| Written | Detail |
|---|---|
| `pvp_wins` / `pvp_losses` | Win/loss counters on both characters |
| `pvp_logs` | Immutable record with each side's total damage |
| Daily and weekly quests | `duel_wins` for the winner, `duel_challenges` for the challenger |

Fighter 2's battle card renders mirrored so the two combatants face each other.

## What is duel level normalization

`crd duel @user level <N>` temporarily recomputes **only the class-stat component** of
both duelists at level N. Gear, deities and runes are unchanged, and nothing is persisted.

<!-- src: src/commands/rpg/duel.js:41 -->

| Rule | Value |
|---|---|
| Valid range | 1 to 50 |
| What is normalized | Class base + scaling stats only |
| What is not normalized | Weapon, armor, deity and rune contributions |
| Persistence | None — stored combat level is untouched |

An out-of-range level replies: *"Level must be between 1 and 50. Example: `crd duel @user
level 50`."*

The card shows `⚖️ Both fight at Level N (gear unchanged).`

## How do wager duels work

A wager duel stakes Credux on the outcome. The winner takes the stake.

<!-- src: src/commands/rpg/duel.js:42 -->

| Rule | Value |
|---|---|
| Maximum stake per duel | 50,000 Credux |
| Cap sharing | Winnings count against the receiver's 1,000,000/day bestow cap |
| Rating change | None |
| Challenge window | 60 seconds |

Syntax and example:

```text
crd duel wager @Friend 10000
```

Rejections: wagering against yourself, against a bot, a non-positive stake, or a stake
above 50,000.

## What blocks a duel from starting

| Gate | Message |
|---|---|
| Target is yourself | *"You cannot duel yourself."* |
| Target is a bot | *"You cannot duel a bot."* |
| Target has no character | *"<user> has no character yet — they need `crd create character` first."* |
| Target is banned | *"<user> cannot be dueled right now."* |
| Either side is mid-raid or mid-boss | *"⚔️ You are in a battle — finish it before challenging anyone."* |
| Either side already has a pending duel | *"Either you or <user> already has an active duel challenge."* |

## How does ranked PvP work

`crd ranked` auto-matches you against a random eligible opponent snapshot and runs a full
battle. Only **your** rating changes — the opponent is offline and untouched.

<!-- src: src/commands/rpg/ranked.js:3 -->

| Command | Alias | Slash | Cooldown | Requires |
|---|---|---|---|---|
| `crd ranked` | `crd rk` | Not available (prefix only) | 15 seconds | A character |
| `crd ranked claim` | `crd rc` | Not available (prefix only) | 15 seconds | A character |

Example:

```text
crd ranked
crd ranked claim
```

Ranked fights use **true** levels, stats and equipment — there is no normalization, so
both build and level matter.

A ranked fight holds a 10-minute lock, so a second `crd ranked` while one is running
replies *"⚔️ You already have a ranked fight in progress."*

## What are the ranked brackets

<!-- src: src/config/ranked.js:9 -->

| Tier | Bracket | Rating range |
|---|---|---|
| 1 | Mortal | 0 – 999 |
| 2 | Champion | 1,000 – 2,499 |
| 3 | Demigod | 2,500 – 4,999 |
| 4 | Ascendant | 5,000 – 9,999 |
| 5 | Divine | 10,000 – 19,999 |
| 6 | Celestial | 20,000 and above |

New characters start at **1,000** rating, the Champion floor.

## How does matchmaking pick my opponent

<!-- src: src/commands/rpg/ranked.js:118 -->

Three attempts, in order:

1. Opponents within ±1 bracket, excluding the player you just fought.
2. Opponents within ±2 brackets, excluding the player you just fought.
3. Opponents within ±2 brackets, allowing a rematch as a last resort.

If all three find nobody: *"⚔️ No eligible opponent in your bracket range right now — try
again later."*

## How much rating do I gain or lose in ranked

Rating change uses tier-difference bands, positioned inside the band by win expectancy. A
harder opponent lands nearer the top of the band; an easier one nearer the bottom.

<!-- src: src/config/ranked.js:78 -->

```js
e    = 1 / (1 + 10 ** ((opponentRating - selfRating) / 1000))   // win expectancy
diff = opponentBracketIndex - selfBracketIndex

// WIN:  band = diff > 0 ? [30,40] : diff < 0 ? [10,20] : [25,30]
//       delta = round(lo + (1 - e) * (hi - lo))
// LOSS: band = diff > 0 ? [8,15]  : diff < 0 ? [30,40] : [20,25]
//       delta = -round(lo + e * (hi - lo))
```

| Result | Opponent bracket | Rating change |
|---|---|---|
| Win | Higher tier | +30 to +40 |
| Win | Same tier | +25 to +30 |
| Win | Lower tier | +10 to +20 |
| Loss | Higher tier | −8 to −15 |
| Loss | Same tier | −20 to −25 |
| Loss | Lower tier | −30 to −40 |

Losing to a weaker opponent — where you were favoured — costs the most.

## How many Valor Medals does a ranked match pay

Valor is only paid while a PvP season is active. Off-season the match still moves rating
but pays 0 Valor and the result line reads `No Valor - off season`.

<!-- src: src/config/ranked.js:100 -->

| Result | Opponent bracket | Valor Medals |
|---|---|---|
| Win | Higher tier | 15 to 20 |
| Win | Same or lower tier | 10 to 15 |
| Loss | Higher tier | 5 to 8 |
| Loss | Same or lower tier | 3 to 5 |

## What is the demotion shield

The demotion shield holds you at your bracket floor for one loss that would otherwise
demote you.

<!-- src: src/commands/rpg/ranked.js:71 -->

| Situation | Result |
|---|---|
| Loss would drop you below your bracket floor, shield active | Rating held at the floor, shield consumed |
| Loss would drop you below your bracket floor, shield already used | You demote, and receive a fresh shield in the new bracket |
| A win promotes you to a new bracket | You receive a fresh shield |
| Rating would go below 0 | Clamped to 0 |

Your peak rating (`pvp_peak`) is tracked separately and never decreases during a season.

## How do I claim weekly ranked rewards

`crd ranked claim` pays a bracket-based bundle once per PHT week.

<!-- src: src/commands/rpg/ranked.js:244 -->

| Requirement | Value |
|---|---|
| Ranked games this PHT week | At least 5 |
| Claims per week | 1 |
| Active season | Required |
| Bracket used | Your **current** rating's bracket at claim time |
| Week boundary | ISO week anchored to Asia/Manila |

Failure messages:

| Condition | Message |
|---|---|
| Already claimed | *"✅ You already claimed this week's ranked reward. Come back next week."* |
| Too few games | *"⚔️ You need 5 ranked games this week to claim (you have N)."* |
| No active season | *"⚔️ No active PvP season — weekly ranked rewards are closed."* |

The payout itself (Credux, Valor and an item payload) is configured per bracket in the
`ranked_reward` table. [UNVERIFIED] — the per-bracket weekly amounts are database rows and
were not read from a live database for this document.

## How do PvP seasons work

A season is a 60-day clock. When it ends, everyone is paid by their **peak** bracket, the
ladder soft-resets, and the season closes until a new one is started manually.

<!-- src: src/engine/seasonEngine.js:16 -->

| Rule | Value |
|---|---|
| Season length | 60 days |
| Season-end payout basis | Peak bracket reached during the season (`pvp_peak`) |
| Soft reset | `rating = max(1000, floor(rating * 0.6))`; peak set to the same value |
| Demotion shield after reset | Restored for everyone |
| Next season | Manual — the season does not auto-start |
| New season start | Every rating and peak reset to exactly 1,000 |

Season-end rewards can include Credux, chests, relics and a rank title.

Season titles:

<!-- src: src/config/titles.js:40 -->

| Bracket | Title granted at season end |
|---|---|
| Celestial | An exclusive rotating title from a fixed six-title cycle |
| Every lower bracket | A generic per-season title, e.g. `Season 3 — Demigod` |

The Celestial rotation is: Embercrowned, Fimbulwinter, Tempest of Amihan, Asphodel, Hand
of Sidapa, Last Dawn — cycling by season number and wrapping.

## What can I spend Valor Medals on

The PvP Shop is the Valor sink. Caps are per season and reset when a new season starts.

<!-- src: src/commands/rpg/pvpShop.js:27 -->

| Command | Syntax |
|---|---|
| Browse | `crd pvp shop` (alias `crd ps`) |
| Buy | `crd pvp buy <id> [qty]` |

| ID | Item | Price (Valor) | Season cap |
|---|---|---|---|
| 1 | Sacred Relic | 800 | 10 |
| 2 | Supreme Chest | 6,000 | 1 |
| 3 | Supreme Relic | 15,000 | 1 |

Example:

```text
crd pvp shop
crd pvp buy 1 5
```

The shop is closed entirely when no season is active: *"No active PvP season. The shop
opens when a season is manually started."*

## How do leaderboards work

`crd leaderboards` shows the top 15 players in one category, filtered to this server or
globally. Two dropdowns switch the scope and the category in place.

<!-- src: src/commands/rpg/leaderboard.js:23 -->

| Command | Alias | Slash | Requires a character |
|---|---|---|---|
| `crd leaderboards` | `crd lb` | Not available (prefix only) | No |

| Category | Ranks by |
|---|---|
| PvP Rating | Current rating, with bracket shown |
| Valor Medals | Valor balance |
| Lifetime Credux | Total Credux ever earned |
| Raids Done | Raids won plus raids lost |
| Raid Wins | Raids won |
| Duel Wins | PvP wins |
| Combat Level | Combat level |
| Believer Level | Believer level |
| Boss Defeats | Boss participation kills |
| Boss Top Hit | Highest single boss hit |

| Setting | Value |
|---|---|
| Entries shown | Top 15 |
| Default view | PvP Rating, Server scope |
| Scopes | Server, Global |

Example:

```text
crd leaderboards
```

## Does PvP give Combat EXP or loot

No. Neither casual duels, wager duels nor ranked matches grant Combat EXP, Credux from
the fight itself, or item drops. Wager duels transfer the agreed stake between players
and ranked pays rating plus Valor.

| Mode | EXP | Credux | Rating | Valor | Items |
|---|---|---|---|---|---|
| Casual duel | No | No | No | No | No |
| Wager duel | No | Stake transfer only | No | No | No |
| Ranked | No | No | Yes | Yes (in season) | No |
