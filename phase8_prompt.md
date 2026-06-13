# PHASE 8 — ENGINE REVISIONS + `crd bestow` (backlog) + DAILY QUESTS

Same session as Phases 6–7 (post-/compact). Re-read before planning — your compacted context may have lost detail: `CREDD_Master_Export_v4.md` is now at **v4.2** with this phase's revisions already patched in (§3 bestow, §11 classes, §12, §13, §14, §16, §20 quests, §15 mob tables). Also re-check `ENGINE_HOOKS.md`, the Phase 6 engine files, and the Phase-5 game_logs conventions.

**This is a money/logic phase: PLAN FIRST, then STOP for my review.** Plan must list files, SQL, math with §-references, selftest changes, and deviations.

**Engine edits ARE authorized this phase** — Scope 1 only, nothing else in the engine. The selftest harness must be UPDATED to match (changed expectations changed deliberately, named in the plan), not weakened. Still untouchable: schema DDL, seeds, summonEngine.js, casino, .env, `// TODO Phase-rep` reputation markers (reputation EXP stays deferred — quest hooks land this phase, rep hooks do NOT).

---

## SCOPE 1 — Battle engine revisions (bug fix + 4 rule changes)

**1a. Overcharge rework + crit bug fix (Mage class passive).**
- BUG: the overcharge attack is currently dealing critical damage. Per §13.1 it must NEVER crit.
- NEW MECHANIC (§11 v4.2): drop the charge accumulator entirely. On every 3rd round of the battle clock (rounds 3, 6, 9, …), the Mage's attack that round gains a flat +200% ATK bonus and the ENTIRE attack has its crit roll suppressed (pre-rolled crit latch voided for that hit; no auto-crit source may upgrade it either).
- If the Mage is skip-CC'd on an overcharge round, that overcharge is lost (no carry-over) — the next fires on the next multiple of 3. Remove the `overcharge_pct` usage from any live code paths (the active_battles column stays, frozen schema — just unused/written as 0).

**1b. Boss actor order: player ALWAYS attacks first in boss mode.** No 50/50 roll when `mode: 'boss'`. EXCEPTION: `special_flags.first_strike` (Sleipnir) still overrides and keeps the boss first. Raid and duel keep the 50/50 roll exactly as-is. Mind the RNG draw-order contract: in boss mode without first_strike, the order roll draw is skipped — document the contract change at the top of battleEngine.js and update determinism tests.

**1c. Snapshot cadence becomes mode-dependent:**
- duel → snapshot EVERY round (duels end fast; HP must visibly drop per turn)
- raid → snapshot on ODD rounds (1, 3, 5, …) + always the final state
- boss → unchanged (no animation; only totals consumed)
battleRender's edit loop consumes whatever snapshots arrive — verify the 1.8s-per-edit pacing still keeps worst-case raid animation comfortably under the reaper's 10-min threshold and state the new worst case in the plan.

**1d. Class base HP 100 → 500** (all five classes, §11 v4.2). Change the base constant where class stats are computed (statAssembly + the class config; keep `computeClassStats` consistent for profile). Per-level HP growth unchanged.

**1e. Mob HP context (no code change, verify only):** all regular/elite mob base HP +500 — ALREADY UPDATED in the live DB by me, and the Master §15 tables now match. Your sandbox can't reach the DB: treat the v4.2 Master tables as the authoritative mirror of the DB. Update any harness fixtures that hardcoded old mob HP. Bosses unchanged.

Selftest additions: overcharge fires on rounds 3/6/9 with crit suppressed even when the crit pre-roll succeeds and even vs auto-crit grants; overcharge lost when skip-CC'd on a multiple of 3; boss-mode order (player first; Sleipnir first); snapshot counts per mode; class HP 500 in stat assembly.

## SCOPE 2 — `crd bestow @user <amount>` (Phase 3 backlog, §3 v4.2)

- Gates: full middleware; sender ≠ receiver; receiver registered + not banned; amount a positive integer; sender balance ≥ amount; **receiver daily cap 1,000,000 Credux/day** via `users.last_bestow_received` + `bestow_received_today` (PHT clock, same as the reset scheduler; stale date → treat today's received as 0). Partial fills NOT allowed — if amount would exceed the receiver's remaining cap, reject and state the remaining headroom.
- Embed (Components V2, one builder): header bestow line → Separator → myth-themed bestow message with the **amount** and the **exact time** of the bestow (Discord timestamp `<t:…:F>`) → Separator → RMT warning → ⚜️ Confirm / ✖ Cancel buttons, **sender only**, 60s expiry. No balances shown anywhere (§3).
- Myth-themed message (use this, tweak freely): `✨ By the will of the gods, **{sender}** bestows **{amount} Credux** upon **{receiver}**. Sealed <t:{unix}:F>.`
- RMT warning (improved wording — use this): `⚠️ **Bestowing Credux in exchange for real money, gift cards, or anything of real-world value is strictly prohibited.** Real-money trading (RMT) in any form will result in a permanent ban for all accounts involved.`
- On Confirm: atomic transfer in one transaction — deduct sender / credit receiver (lock both users_bag rows in sorted discord_id order, Phase-5 convention), update receiver's cap counters, two `game_logs` rows (action 'Bestow', credux before/after per §game_logs conventions: sender negative delta, receiver positive). Re-validate balance and cap INSIDE the transaction (state may have changed since the embed). On Cancel/expiry: disable buttons, nothing written.
- Quest hook: none (bestow isn't in the quest pool). `// TODO Phase-rep` marker for the §18 rep award (`crd bestow` = 50 rep) — do not implement.

## SCOPE 3 — DAILY QUESTS (`crd quests`, §20)

**System:**
- 3 quests/player/day from the §20 pool (raid_wins / elite_defeats / credux_spent / weapon_enhancements / duel_wins / duel_challenges — match the `daily_quests.quest_type` values), no duplicate types per day, target randomized within the §20 ranges, reward fixed by the §20 count-scaled tables at roll time (store into reward_credux/reward_belief_shards).
- Roll at midnight PHT inside the existing reset scheduler for active players, AND lazily on demand: any quest read/progress event finding no rows for (user, today) rolls them first. UNIQUE (discord_id, quest_type, quest_date) makes the lazy roll race-safe (ON CONFLICT DO NOTHING).
- **Progress hooks** (increment current_count, clamp at target; when reaching target: set completed, **auto-grant the reward immediately** — credit users_bag + one game_logs row per currency, action 'Daily' is taken — use a distinct action label consistent with the §game_logs action list, propose one in the plan): raid win → raid_wins; elite raid win → BOTH raid_wins and elite_defeats; credux spent on weapon enhancement → credux_spent (attempt cost, success or fail); each enhance attempt → weapon_enhancements; duel win → duel_wins; duel challenge ACCEPTED and fought → duel_challenges (proposal — challenges that expire/decline don't count; flag if you read §20 differently).
- Completion notice: append one line to the triggering command's output/footer (e.g. `📋 Quest complete: Win 5 raids — +6,000 Credux, +10 Shards`). No DMs.

**`crd quests` embed — Components V2 + canvas body, exactly this:**
1. Header: `📋 Daily Quests`
2. Separator
3. `Resets in X hours` — countdown to midnight PHT (compute hours remaining; static text is fine)
4. **CANVAS RENDER** (MediaGallery attachment) — same visual format/style as the `crd bag` chests body: 3 quest rows, each with quest name, progress bar `▓▓▓░░ X/Y`, reward (with credux/shard emoji), and status ✅ (done) or 🔄 (in progress)
5. Separator
6. Footer lore line, italic: *"The gods reward those who prove their worth."*

## DELIVERABLES FOR THE PLAN (then STOP)

1. File list; every SQL statement vs the frozen schema; the quest-roll and auto-grant transactions; the bestow transfer transaction with in-transaction re-validation.
2. Engine diff summary (1a–1d) + every selftest expectation that changes and why; new worst-case raid animation time vs the reaper.
3. Edge cases: bestow double-confirm race; receiver hits cap mid-confirm; quest progress from a raid that's both win and elite; lazy roll vs midnight roll collision; Mage skip-CC on round 3; Sleipnir + boss mode; duel snapshot volume at round 50.
4. Anything in §20/§3 you read differently than this prompt — flag, don't decide silently.

After approval: build, static validation (updated selftest passes, node --check, SQL column check), then STOP — I restart and live-test bestow (cap, RMT embed, confirm/cancel), quests (roll, progress from raid/duel/enhance, auto-grant, embed render), a Mage raid (overcharge rounds 3/6/9, no crits on them), a boss attack (player first; Sleipnir check), and duel/raid edit cadence.
