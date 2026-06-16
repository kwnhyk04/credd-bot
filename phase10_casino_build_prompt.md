# PHASE 10 — CASINO SYSTEM (BUILD — approved spec)

Continuing **Credd — The Last Believer** (discord.js v14 + Supabase). Phases 1–9 committed and live-tested. Phase 10 builds the full casino: six games. Casino was on the do-not-touch list through Phase 9 — it is now the active target.

**This is the highest money-surface phase — Opus high-effort, maximum care on the settlement path.** Re-read first: the casino mechanics are defined in the attached `Phase_10_Mechanics.txt` (AUTHORITATIVE for all game logic, probabilities, asset filenames, and flavor). The six screenshots are embed-layout references ONLY — see the slot caveat below. Also re-read `credd_schema_v4.sql` (frozen) and the existing engine/render conventions (battle engine's pure-core split, `renderBagItems`/`battleRender` for fonts/emoji-cache/GIF attachment patterns).

**No schema change is needed or allowed** — I verified: `casino_logs` already exists with `discord_id, game, bet_amount, result('win'|'loss'), payout, balance_before, balance_after, metadata JSONB, timestamp`, and its `game` CHECK already permits coin_toss/dice_roll/baccarat/blackjack/slot_machine/crash. Currency is `users_bag.credux`. Untouchable: schema DDL, seeds, summonEngine.js, the battle engine, .env, `// TODO Phase-rep`. Branch `master`.

---

## CORE PRINCIPLE (non-negotiable)
All randomness and outcomes are decided on the BACKEND before anything renders. The embed only visualizes a result already computed. No game logic lives in command/render code. Every draw uses a single crypto-backed RNG (`crypto.randomInt`), never `Math.random` — casino fairness; the self-test greps for violations. No patterns, no per-user luck, no state carried between games. **All wins pay 100% of the stated multiplier** (virtual economy, no house edge, no real-payout shaving, no commissions).

## ARCHITECTURE
```
src/casino/
  rng.js          crypto-backed uniform helpers (randomInt(range), pick) — the ONE rng source
  payoutTables.js ALL multipliers + bet limits in one place (single source of truth)
  cardDeck.js     52-card model, suit/value maps, asset-filename resolver
  coinToss.js  diceRoll.js  baccarat.js  slotMachine.js   -> pure (bet,pick) -> outcome
  blackjack.js  crash.js                                  -> stateful session objects
  betGuard.js     shared bet validation + the atomic money path (below)
  casinoRender.js CV2/embed builders + GIF attachment wiring (per the 5 valid screenshots)
src/commands/casino/  6 thin commands: parse bet -> betGuard -> call engine -> animate -> settle -> log
scripts/casino-selftest.js   sandbox-safe fairness + payout-integrity harness
```
Pure engines take an injectable rng so the harness can force any face/hand/crash point.

## THE MONEY PATH — shared `betGuard` (centralized, reviewed once)
- **Bet validation:** positive integer (commas tolerated); `bet <= balance`; `bet <= maxBet(game)`. **Max bets: 150,000 for ALL games EXCEPT crash = 25,000.** Reject with plain-text errors; no DB write on rejection. Per-command 10s cooldown via existing middleware. **Entry gate: registered account with sufficient Credux — a created character is NOT required** (casino commands use mw:'full' but requiresCharacter:false).
- **Instant games (coin, dice, baccarat, slot):** compute outcome first, then ONE atomic transaction settling the NET result — never debit the stake separately. Win → `credux += (payout − bet)`; loss → `credux -= bet`, guarded `WHERE credux >= bet`. One `casino_logs` row; `payout` = gross returned (0 on loss); `balance_before/after` bracket the game.
- **Stateful games (blackjack, crash):** DEBIT the bet up front in a transaction (locks the funds against double-spend), hold the session in an in-memory Map keyed by discord_id (ONE active blackjack AND one active crash per user — reject a second with "finish your current game first"), then on resolution CREDIT the full payout (0 on loss) in a second transaction. Bot restart mid-session = bet already debited = loss (acceptable; this is why we debit up front). `casino_logs.payout` still records gross returned.
- Never allow negative balance; never debit more than balance; a win must never double-count the stake. Document the netting convention at the top of betGuard.js.

## GAMES

### Coin Toss — `crd coin toss [amt] heads/tails` (alias `crd ct [amt] h/t`)
True 50/50. Heads = **Aeternvm**, Tails = **Obscvrvm**. Match → 2× (even money). GIFs `assets/casino/coin/flip_heads.gif` / `flip_tails.gif` (loop-once, show at result, ~3s). Embed (Screenshot 1): header "Coin of Fates" + icon, `@user has bet [amt] credux on Heads/Tails`, NO separator, centered GIF, centered face-name result line, space, win/loss banner, separator, `Balance:` (show pre-result balance during spin, update after).

### Dice Roll — `crd dice roll [amt] odd/even` (alias `crd dr [amt] o/e`)
Two independent `randomInt(1..6)` (equal per face). Total parity vs pick → 2×. Both GIFs `assets/casino/dice/dice_roll_{n}.gif` shown simultaneously. Result `Total: {sum} — Even/Odd`, then `{d1} + {d2} = {sum}`. Embed (Screenshot 2): header "Trial of the Ancients" + icon, same skeleton as coin.

### Baccarat — `crd baccarat [amt] banker/player` (alias `crd bac [amt] b/p`)
Standard baccarat: 2 cards each, then player third-card rule, then banker third-card rule. Draws uniform across 13 ranks × 4 suits (rank-roll uses A=1,J=11,Q=12,K=13 for selection only; baccarat point values A=1, 2–9 pip, 10/J/Q/K=0; score = sum mod 10). **No banker commission.** Player or Banker bet wins → 2×. **Tie → push (bet returned).** Suits: Abyss=Clubs, Tempest=Spades, Lunar=Hearts, Solar=Diamonds; cards `assets/casino/cards/{suit}_{rank}.gif` (e.g. `abyss_a.gif`, `solar_k.gif`). Embed (Screenshot 3): header "The Oracle's Table", suit legend, PLAYER | BANKER columns + scores, "X vs Y — Winner", banner, balance.

### Blackjack — `crd blackjack [amt]` (alias `crd bj [amt]`)
Stateful, user vs dealer. Deal 2 to player, 2 to dealer (one face-down using `assets/casino/cards/card_back.png`). Player Hit/Stand buttons (gated to the bettor, session-locked, 60s inactivity → auto-stand). Standard values; Ace = 1 or 11 (best). Dealer reveals on stand, hits until 17 (stands on soft 17). Bust = immediate loss. Natural 21 pays normal 2× (no bonus — all-wins-100% rule). Card back swaps to the rank GIF on reveal. Embed (Screenshot 4): header "The Sacred XXI", DEALER (shows `?` while hidden) / YOU rows + scores, Hit/Stand, balance.

### Slot Machine — `crd slot machine [amt]` (alias `crd sm [amt]`)
**IGNORE Screenshot 5's legend entirely — it was a Sonnet mock-up. The authoritative faces, multipliers, probabilities, and filenames are from `Phase_10_Mechanics.txt`:**
Sequential probability ladder, highest-prize-first; each step an independent crypto roll at its own probability; first hit wins and stops:
1. Wings 1% → 3× Wings → pay **×20**
2. else Trident 5% → 3× Trident → **×10**
3. else Skull 10% → 3× Skull → **×5**
4. else Lightning 50% → 3× Lightning → **×2**
5. else Horus 50% → 3× Horus → **×1.5**
6. else LOSE → render a non-winning combo (2-same-1-diff or 3-diff) — **must NOT be three of a kind; generate then assert.**
Three reels, staggered GIF lengths: reel1 from `assets/casino/slots/3s/` (3s), reel2 from `4s/` (4s), reel3 from `5s/` (5s); filenames `{3s|4s|5s}_{face}_{n}.gif` (n: horus_1, lightning_2, skull_3, trident_4, wings_5). On a win all three reels show the SAME face; reveal staggered (reel 2 lands ~1s after reel 1, reel 3 ~1s after reel 2). Embed (Screenshot 5 layout only): header "The Vault of Relics", 3 reel cells, payline, a multiplier legend built from the REAL faces above (Horus ×1.5 / Lightning ×2 / Skull ×5 / Trident ×10 / Wings ×20), banner, balance.

### Crash — `crd crash [amt]`
Max bet **25,000**. Stateful push-your-luck; bet debited up front. Locked base progression:

| Push | Crash chance | Cash-out multiplier |
|---|---|---|
| 1 | 20% | 1.45× |
| 2 | 25% | 2.10× |
| 3 | 30% | 3.05× |
| 4 | 35% | 4.42× |
| 5 | 40% | 6.40× |
| 6 | 45% | 9.28× |

**Beyond push 6: EXTEND the curve** — continue +5% crash chance and ×~1.45 multiplier per push (push 7 = 50% / ~13.46×, push 8 = 55% / ~19.5×, …), capping crash chance at 75% (pushes past that stay at 75%). Keep multipliers geometric (×1.45 step) so the published 1–6 rows match exactly. Each push: roll the crash chance FIRST; crash → lose the (already-debited) bet, show that push's multiplier as the crash point; survive → offer Cash Out (credit `bet × current multiplier`) or Push. Buttons Push / Cash Out, user-gated, session-locked. **60s inactivity → AUTO-CASH-OUT at the current safe multiplier** (player-friendly). Embed (Screenshot 6): header "The Ascension", big multiplier / CRASH display, push counter, Push/Cash Out, balance.

## FAIRNESS & SELF-TEST (`scripts/casino-selftest.js`, sandbox-safe)
- Static grep: no `Math.random` anywhere in `src/casino/`.
- Distribution (large N, mock rng): coin ~50/50; each die face ~1/6 + parity ~50/50; card ranks/suits flat; slot tier frequencies match the 1/5/10/50/50 ladder within tolerance; crash per-push crash-rate matches the table.
- **Payout integrity (money-critical):** for every game × outcome, `balance_after − balance_before` equals the intended net exactly; a loss never deducts more than the bet; a win never credits more than gross payout; `casino_logs.payout`/result label always consistent; no negative balance, no debit exceeding balance.
- Slot lose-branch never emits three-of-a-kind (assert over many forced loses).
- Bet guards: over-max (crash 25k boundary; others 150k), over-balance, zero/negative, non-integer → rejected, no DB write.
- Stateful: blackjack bust=loss, dealer hits to threshold, one-session lock, no double-spend; crash debit-up-front then correct credit; auto-cashout on timeout credits correctly; curve extension past push 6 matches the formula.

## DOC PATCH (repo Master, tag `[v4.5]`)
Patch §24 in the root-folder `CREDD_Master_Export_v4.md`: per-game mechanics, face flavor (Aeternvm/Obscvrvm), suit mapping (Abyss/Tempest/Lunar/Solar), the slot ladder + multipliers, the crash progression table + extension rule + 25k cap, a max-bet table (150,000 all games / 25,000 crash), the 100%-payout/virtual-economy/no-commission note, and the per-game `casino_logs.metadata` shape.

## WIRING
`commandHandler.js`: register all six + aliases (ct/dr/bac/bj/sm/crash), mw:'full', requiresCharacter:false. `interactionHandler.js`: route blackjack (hit/stand) and crash (push/cashout) button customIds to their sessions. Untouched: schema, seeds, summonEngine, battle engine, .env.

## BUILD & STOP
Build all six games + shared infra + harness + doc patch. Static validation: `node --check` on every file; `casino-selftest.js` fully green (fairness + payout integrity); verify every column used against `casino_logs`/`users_bag` in the frozen schema; confirm no `Math.random` in `src/casino/`. Then STOP and report: files changed, selftest summary (distribution + payout-integrity results), the crash-extension formula you implemented, the `[v4.5]` doc diff, and any asset filename that doesn't resolve against the conventions. I then drop/confirm the GIF assets, restart, and live-test each game's WIN and LOSS path plus every bet guard.
