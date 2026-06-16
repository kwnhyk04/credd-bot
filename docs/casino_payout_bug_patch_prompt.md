# PATCH — CRITICAL casino payout bug + card_back render bug + baccarat sequential deal

Continuing **Credd — The Last Believer**. Three items. **Item 1 is a money-integrity bug and takes priority — do it first and most carefully.** Untouchable: schema, seeds, summonEngine, .env, `// TODO Phase-rep`. Branch `master`.

---

## 1. CRITICAL — casino WINS are not crediting Credux

**Symptom:** losing bets deduct Credux correctly (and the embed shows the deduction), but WINNING bets do not add the winnings — the player's `crd bag` balance does not increase after a win. Net effect: the casino only ever takes, never pays. This is losing players real in-game currency on every win.

**Do NOT just patch the symptom — find the root cause first and tell me what it was.** Investigate in this order and report findings:
1. Trace the WIN settlement path end to end for an instant game (coin/dice/baccarat/slot): engine returns `{win:true, payout}` → command → `betGuard` settlement → `UPDATE users_bag` → `casino_logs`. Find exactly where the credit is lost.
2. **Prime suspect — the net-settlement convention.** The instant-game design was "never debit the stake; settle NET" (win → `credux += payout − bet`; loss → `credux -= bet`). Likely failure modes to check:
   - the win branch computing `payout − bet` but then never executing the UPDATE (e.g. only the loss branch writes to the DB), or
   - the win UPDATE running but with a `WHERE credux >= bet` style guard or a wrong sign that no-ops it, or
   - `payout` arriving as 0 / bet-only on wins (engine returns gross but command reads net, or vice versa — double-subtraction), or
   - the win path updating a local object / the embed only, never persisting to `users_bag`.
3. Check the STATEFUL games (blackjack/crash) separately — they use debit-up-front then credit-payout; confirm the credit-on-win transaction actually fires and commits (a win there means the up-front debit must be returned PLUS winnings).
4. Confirm the transaction COMMITs (not rolled back / not left open) and that the credit isn't being overwritten by a later balance read.

**Fix:** correct the settlement so a win persists the correct amount to `users_bag.credux` and `casino_logs` reflects it (`payout` = gross returned, `balance_after` = real post-credit balance). Verify against the netting convention so a win credits exactly the intended net and never double-counts or zeroes out.

**Then prove it — the self-test clearly was NOT catching this, which is itself a problem:**
- The casino-selftest's payout-integrity section was supposed to assert `balance_after − balance_before` equals the intended net for every win. Either it wasn't exercising the real settlement path (only the pure engine), or it was mocking the DB write. **Make the payout-integrity test exercise the ACTUAL settlement code path** (the same `betGuard` function the commands call), not a reimplementation — use a fake/in-memory balance the real settlement writes through, so a regression like "win branch never writes" is caught. Add explicit cases: win credits +net, loss debits −bet, and balance strictly increases after a win, for all six games.
- Report the root cause in plain terms, the exact lines changed, and the new/updated test that now fails on the old code and passes on the fix.

This is the highest-priority change. If anything else in this patch conflicts with getting it right, do this one alone and correctly.

## 2. BUG — `card_back.png` not rendering
The dealer/baccarat back-of-card image isn't displaying. The file is in the img folder — **confirm the exact path and filename the code is looking for vs. where the asset actually is** (`assets/casino/cards/card_back.png`? a different `img` folder? `back_card.png` vs `card_back.png` — the request calls it `back_card.png`, earlier specs said `card_back.png`; reconcile the real filename). Fix the resolver/path so it loads. Report the actual filename + path you found and what was mismatched. Graceful fallback if missing, but the goal is it renders.

## 3. Baccarat — sequential deal with face-down backs first (mirror blackjack's reveal edit style)
Change baccarat from showing the final hands at once to a real-baccarat sequential reveal, using the same edit-in-place animation pattern blackjack already uses:
- First render **4 face-down `card_back` cards** — 2 in the Player row, 2 in the Banker row (the standard initial baccarat layout).
- Then reveal **one card at a time in proper baccarat order** (Player 1st, Banker 1st, Player 2nd, Banker 2nd), editing the message to flip each back card to its face PNG in sequence with a short beat between each (reuse blackjack's message-edit cadence).
- If a third card is drawn (per the third-card rules already implemented), deal it face-down then flip it in the same style.
- The OUTCOME is still fully decided on the backend up front (item 1's settlement is unchanged by this) — this is purely the reveal sequence. Final state shows all cards face-up, scores, result, balance.
- Keep the item-1 fix authoritative: settlement fires at the END of the reveal, and it must CREDIT wins correctly.

## 4. Coin toss — result is firing 0.5s late, shift it −0.5s
The reveal is landing half a second later than intended. Pull the result reveal earlier by 0.5s so it lands on the intended mark. Net effect: subtract 0.5s from the current reveal delay. Backend outcome unchanged — timing only.

---

## BUILD & VALIDATION
`node --check`; casino-selftest green INCLUDING the new real-settlement payout-integrity cases from item 1 (these must fail against the buggy code and pass after the fix — show that); confirm no `Math.random` introduced; card draw still unique-per-hand and fair. Report: the item-1 root cause + lines changed + the test that catches it, the `card_back` filename/path mismatch found, and confirmation that wins now credit correctly across all six games. Then STOP — I restart and live-test, in this order: a guaranteed-ish win on coin/dice (verify `crd bag` balance goes UP by the right amount), a blackjack and crash win (debit returned + winnings), baccarat sequential reveal with backs-first, and `card_back` rendering.
