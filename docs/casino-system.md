# Casino System

The Credd casino is six wager games played with Credux: coin toss, dice roll, baccarat,
blackjack, the slot machine, and crash. Every game pays 100% of its stated multiplier —
there is no house edge, no baccarat commission and no payout shaving. This document gives
every multiplier, probability and bet limit.

Casino games are for fun only. Credux has no real cash value and cannot be exchanged for
anything of real-world value.

## What casino games are there

<!-- src: src/handlers/commandHandler.js:116 -->

| Game | Command | Alias | Slash | Cooldown |
|---|---|---|---|---|
| Coin Toss | `crd coin toss <amount> heads\|tails` | `crd ct` | `/coin toss amount: side:` | 10 s |
| Dice Roll | `crd dice roll <amount> odd\|even` | `crd dr` | `/dice roll amount: side:` | 10 s |
| Baccarat | `crd baccarat <amount> banker\|player` | `crd bac` | `/baccarat amount: side:` | 10 s |
| Blackjack | `crd blackjack <amount>` | `crd bj` | `/blackjack amount:` | 10 s |
| Slot Machine | `crd slot machine <amount>` | `crd sl`, `crd sm` | `/slot machine amount:` | 10 s |
| Crash | `crd crash <amount>` | — | `/crash amount:` | 10 s |

Examples:

```text
crd coin toss 500 heads
crd dice roll 1000 odd
crd baccarat 2500 banker
crd blackjack 5000
crd slot machine 500
crd crash 10000
```

None of the casino games require a character — only a registered account.

## What is the maximum bet

<!-- src: src/casino/payoutTables.js:14 -->

| Rule | Value |
|---|---|
| Maximum bet | 500,000 Credux, for every game including crash |
| Minimum bet | 1 Credux |
| `max` keyword | Bets the ceiling, or your whole balance if it is smaller |

A bet must be a positive whole number; commas are tolerated. Rejections happen before any
database write, so a rejected bet costs nothing.

| Condition | Reply |
|---|---|
| Missing bet | *"Enter a bet — e.g. `crd coin toss 500 heads` (or `max`)."* |
| Non-numeric | *"Your bet must be a positive whole number of Credux."* |
| Over the cap | *"The maximum bet for this game is **500,000** Credux."* |
| Over your balance | *"You don't have enough Credux. Your balance is **N**."* |

## How does coin toss work

<!-- src: src/casino/coinToss.js:4 -->

A true 50/50 call. Matching the result pays even money.

| Property | Value |
|---|---|
| Heads face name | Aeternvm |
| Tails face name | Obscvrvm |
| Win chance | 50% |
| Payout on a win | 2× the stake (gross) |
| Payout on a loss | 0 |

## How does dice roll work

<!-- src: src/casino/diceRoll.js:4 -->

Two independent six-sided dice; you call the parity of their total.

| Property | Value |
|---|---|
| Dice | 2 × d6, each face equally likely |
| Call | `odd` or `even` |
| Win chance | 50% |
| Payout on a win | 2× the stake (gross) |

The total ranges 2–12; odd and even are exactly equally likely with two fair dice.

## How does baccarat work

<!-- src: src/casino/baccarat.js:4 -->

Standard punto banco, dealt from a single 52-card deck without replacement.

| Rule | Detail |
|---|---|
| Opening deal | 2 cards to Player, 2 to Banker |
| Natural | Either hand totalling 8 or 9 on the first two cards stands |
| Player third card | Draws on 0–5, stands on 6–7 |
| Banker third card | Standard third-card matrix against the Player's third-card value |
| Commission | **None** — a Banker win pays the full 2× |
| Tie | **Push** — the stake is returned |
| Payout on a win | 2× the stake (gross) |

The banker's draw decision uses its **original two-card score**:

| Banker two-card score | Draws when |
|---|---|
| 0 – 2 | Always |
| 3 | Player's third card is not an 8 |
| 4 | Player's third card is 2–7 |
| 5 | Player's third card is 4–7 |
| 6 | Player's third card is 6–7 |
| 7 | Never — stands |

If the Player stood, the Banker draws on 0–5 and stands on 6–7.

## How does blackjack work

<!-- src: src/casino/blackjack.js:4 -->

You versus the dealer, one 52-card deck per round dealt without replacement.

| Rule | Detail |
|---|---|
| Opening deal | 2 cards to you, 2 to the dealer (one face down) |
| Ace value | 1 or 11, whichever is better |
| Your actions | Hit or Stand buttons |
| Hitting to 21 | Auto-stands |
| Busting over 21 | Immediate loss |
| Dealer rule | Hits until 17, **stands on soft 17** |
| Natural 21 | Pays the normal 2× — there is no 3:2 bonus |
| Push | Stake returned |
| Session timeout | 60 seconds |

An opening natural on either side settles immediately from the original four cards, so
the dealer never draws against your natural 21 to manufacture a push.

The bet is debited up front and the full payout is credited on resolution.

## How does the slot machine work

<!-- src: src/casino/slotMachine.js:4 -->

Three reels with a highest-prize-first probability ladder. Each rung is an independent
roll at its own probability; the first hit wins and stops.

<!-- src: src/casino/payoutTables.js:29 -->

| Rung | Face | Probability | Multiplier |
|---|---|---|---|
| 1 | Wings | 1% | ×20 |
| 2 | Trident | 5% | ×10 |
| 3 | Skull | 10% | ×5 |
| 4 | Lightning | 30% | ×2 |
| 5 | Horus | 30% | ×1.5 |

Because the rungs are independent and resolve in order, the effective win chance is
`1 - (0.99 × 0.95 × 0.90 × 0.70 × 0.70)` ≈ **58.5%**.

| Rule | Detail |
|---|---|
| On a win | All three reels show the same face |
| On a loss | A combo that is guaranteed **not** to be three of a kind |
| Fractional multipliers | Gross payout is floored: `floor(bet × multiplier)` |

## How does crash work

<!-- src: src/casino/crash.js:4 -->

Push-your-luck. Each push rolls a crash chance first; surviving locks in a higher
multiplier. Cash out at any time.

| Property | Value |
|---|---|
| Maximum pushes | 10 |
| Crash chance at push N | `min(75, 15 + 2 × (N − 1))` |
| Session timeout | 60 seconds, then auto cash-out |

<!-- src: src/casino/payoutTables.js:44 -->

| Push | Crash chance | Multiplier if survived |
|---|---|---|
| 1 | 15% | 1.45× |
| 2 | 17% | 2.10× |
| 3 | 19% | 3.05× |
| 4 | 21% | 4.42× |
| 5 | 23% | 6.40× |
| 6 | 25% | 9.28× |
| 7 | 27% | 13.46× |
| 8 | 29% | 19.51× |
| 9 | 31% | 28.29× |
| 10 | 33% | 41.02× |

Multipliers past push 6 extend geometrically at ×1.45 per push:

```js
crashMultiplier(push) = round2(9.28 * 1.45 ** (push - 6))   // for push > 6
```

Gameplay ends after surviving push 10, so the formula's 75% crash ceiling is unreachable.

| Outcome | Payout |
|---|---|
| Cash out | `floor(bet × currentMultiplier)` |
| Crash | 0 — the already-debited bet is lost |
| Never pushed, cash out at push 0 | 1× the stake back |

## How is a payout calculated

Every game reports `payout` as the **gross** amount returned to you, stake included.

<!-- src: src/casino/betGuard.js:8 -->

| Outcome | Gross payout | Net profit |
|---|---|---|
| Even-money win | 2 × bet | + bet |
| Push (baccarat tie, blackjack push) | bet | 0 |
| Loss | 0 | − bet |
| Slot ×20 win | floor(bet × 20) | + 19 × bet |

Because the log field is binary, a **push is logged as a win** with payout equal to the
bet and an unchanged balance. "Win" in the log means "Credux came back", not necessarily
"profit".

## How is my money protected during a casino game

Two settlement shapes, both atomic.

<!-- src: src/casino/betGuard.js:16 -->

| Shape | Games | Behaviour |
|---|---|---|
| Instant | Coin, dice, baccarat, slot | Outcome computed first, then one transaction settles the net under a row lock |
| Stateful | Blackjack, crash | Bet debited up front to lock the funds, then the full payout credited on resolution |

Invariants enforced in both shapes:

| Invariant | Guarantee |
|---|---|
| Never a negative balance | Enforced by a `WHERE credux >= bet` guard |
| Never debit more than your balance | Enforced under `FOR UPDATE` |
| A win never double-counts the stake | Net settlement on instant games |
| No database write on a rejected bet | Validation happens before any transaction |

A bot restart in the middle of a blackjack or crash session leaves the bet debited, which
counts as a loss. That is exactly why those games debit up front.

## Is the casino fair

Every roll uses a crypto-backed random source, and each game engine is pure — no database
access, no Discord calls, and no `Math.random`. The slot machine additionally asserts that
its losing branch can never emit three of a kind.

There is no house edge on any game: all wins pay the full stated multiplier.

## Can the casino be disabled

Yes. Casino commands are gated by the `CASINO_ENABLED` environment variable, which
defaults to enabled. When it is turned off, all six commands route to a disabled notice
instead of the game engines.

<!-- src: src/handlers/commandHandler.js:52 -->
