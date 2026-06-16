# PATCH — Casino render cleanup + timing + slot probability

Continuing **Credd — The Last Believer**. Small casino tweaks: render cleanup, two timing fixes, one probability change. Build-direct. Untouchable: schema, seeds, summonEngine, .env, `// TODO Phase-rep`. Branch `master`. Patch repo-root `CREDD_Master_Export_v4.md` for the probability change, tag `[v4.7]`.

---

## 1. Baccarat embed — remove the suit legend row
Remove the `🐎 Pegasus · 🔱 Trident · 🌿 Laurel · 🔨 Hammer` suit-icon legend line under the bet line. It clutters the layout. Keep everything else (PLAYER/BANKER columns, scores, result, balance).

## 2. Score lines — show ONLY the score, drop the per-card suit/rank breakdown
On both baccarat and blackjack, the score header currently reads like `PLAYER — Score 5 · 10H 10P 5P`. Remove the trailing card-shorthand (`10H 10P 5P`, `4L 6H 6H`, etc.) — show just `PLAYER — Score 5` / `BANKER — Score 6` (and `YOU — Score X` / `DEALER — Score X` for blackjack). The card images already show the cards; the shorthand is redundant.

## 3. Card canvas — remove the overlaid rank NUMBERS/text
For ALL card rendering (baccarat AND blackjack), stop drawing the rank text/number overlays on the canvas (the big `10`, `5`, `6`, corner numbers, etc. currently painted over the card art). The card PNG assets already show their ranks clearly, even when compressed. Just composite the card image itself — no text drawn on top. (Keep the dealer hole-card `card_back.png` as-is.)

## 4. Coin toss — result is firing 0.5s late, shift it −0.5s
The reveal is landing half a second later than intended. Pull the result reveal earlier by 0.5s so it lands on the intended mark (the prior spec was GIF 0–4s, hold, reveal result PNG at 4.5s → it's effectively showing at ~5.0s; correct it so the reveal actually happens at 4.5s). Net effect: subtract 0.5s from the current reveal delay. Backend outcome unchanged — timing only.

## 5. Dice roll — drop the `{d1} + {d2} = {sum}` line
Remove the addition breakdown line (e.g. `6 + 6 = 12`). Keep only `Total: {sum} — Even/Odd`. The dice images show the individual values.

## 6. Slot machine — reveal timing + probability change
- **Reveal at 9 seconds.** Currently the result text appears before the reels finish animating (reels run 3s/4s/5s staggered). Hold the result reveal until **9 seconds** so all three reels have fully landed before the outcome/payout shows. (Reels still stagger as before — only the final result reveal moves to the 9s mark. Confirm the longest reel finishes by 9s; if the staggered total runs past 9s, align the reveal to just after the last reel lands and flag the actual timing.)
- **Change Horus and Lightning probabilities from 50% to 30% each.** New ladder (highest-first, sequential independent rolls, first hit wins):
  1. Wings 1% → ×20
  2. Trident 5% → ×10
  3. Skull 10% → ×5
  4. Lightning **30%** (was 50%) → ×2
  5. Horus **30%** (was 50%) → ×1.5
  6. else LOSE (non-matching combo, never 3-of-a-kind)
  - This lowers the overall win rate (the lose branch gets larger). Recompute and report the new net win probability. Update the slot self-test tier-frequency assertions to the new 30/30 values. Multipliers unchanged.
  - Patch Master §24 `[v4.7]`: Lightning 30% / Horus 30%.

## 7. BUG — cards must be unique within a hand (cardDeck draw logic)
In the provided baccarat screenshot the Banker shows **two identical Hammer 6 cards** — the deck is drawing WITH replacement (each card rolled independently), so duplicates of the exact same suit+rank can appear in one deal. Fix at the deck level so it applies to BOTH baccarat and blackjack:
- Model a real shoe: build the full set of cards (52 per deck, or an N-deck shoe — your choice, flag which), then DEAL WITHOUT REPLACEMENT for a given hand/round — once a specific suit+rank is dealt, it cannot be dealt again in that same hand. A standard shoe naturally allows the same rank in different suits (two different 6s is fine); it must never produce the exact same suit+rank twice.
- Keep draws uniform/fair (crypto rng, shuffle or uniform-pick-then-remove) — fairness and flat rank/suit distribution must be preserved; this only removes exact-duplicate cards.
- If you use a single 52-card deck per round, a hand can never exhaust it (baccarat max 6 cards, blackjack well under 52), so single-deck-per-round is the simplest correct model — confirm what you implement.
- Add a self-test assertion: over many dealt hands, no hand ever contains the same suit+rank twice (baccarat and blackjack both).
- card_back.png is in img folder

---

## BUILD & VALIDATION
`node --check` on touched files; casino-selftest green with the updated slot tier-frequency expectations (and the recomputed net win rate) AND the new no-duplicate-card assertion (item 7); confirm payouts/outcomes otherwise unchanged (renders and timing don't touch settlement math). Report: files changed, the new slot net win probability, confirmation outcomes/payouts are unchanged, slot reveal timing vs the 9s target, the deck model you used for the unique-card fix (single-deck-per-round vs N-deck shoe), and the `[v4.7]` doc diff. Then STOP — I restart and live-test: baccarat (no legend, score-only, no rank text), blackjack (score-only, no rank text), coin reveal timing, dice result line, and a batch of slot spins for the 9s reveal + the lower win rate feel.
