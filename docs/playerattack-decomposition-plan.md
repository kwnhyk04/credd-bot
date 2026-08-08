# playerAttack decomposition — plan

Analysis only. No code written, nothing under `src/` changed.

Line references are against `src/engine/battleEngine.js` at commit `48db4cc`,
where `playerAttack` spans **lines 1205–1656 (452 lines)**. Ranges were
re-derived by brace-matching under node and confirmed by reading the function in
full — not carried over from earlier sessions and not taken from text search.

**Bottom line: four cuts earn their place. Six candidates are rejected.
`playerAttack` goes 452 → ~343 lines. That is a real but modest win, and it does
not make the attack path readable — see section 5 before deciding.**

---

## 0. One constraint needs interpreting

The goal bars "module-scope hoisting, new parameters, or any change to who owns
`shared`, the combat log, or `result`."

Read literally, "new parameters" would forbid a new closure from taking `(S, O)`.
That makes the project impossible: a cut that takes no parameters must be nested
*inside* `playerAttack` to capture `S`/`O` lexically, and a nested closure still
lives inside `playerAttack`, so its line count does not drop at all — it rises
by the declaration line.

I read the constraint as barring signature changes to the *existing* functions
(`playerAttack`, `mobAttack`, `act`) — the `fx`-bag mistake — not as barring
parameters on newly created helpers. Every cut below is a **new sibling closure
declared inside `resolveBattle`**, taking only values already in scope at its
call site. No existing signature changes. Nothing moves to module scope.
`shared`, the combat log, and `result` keep their current owners.

If that reading is wrong, the honest answer is that no cut reduces
`playerAttack` and the project should not run.

---

## 1. Structure map

`playerAttack` is one function with a large nested closure (`doHit`) doing the
actual swing. In execution order:

| # | Stage | Lines | n | What it does |
|---|---|---|---|---|
| 1 | Context + scratch baseline | 1206–1239 | 34 | Derives primary/additional, source, scale; on an additional attack restores `S.scratch` from the baseline; publishes `S.scratch.attackContext` |
| 2 | Tyrfing execute | 1240–1253 | 14 | Below-threshold execute; **early return** |
| 3 | Attack hooks | 1254–1258 | 5 | Fires `S.scratch.attackHooks`, buffers their log lines |
| 4 | Durable flag consumption | 1260–1292 | 33 | Consumes Amihan, Idiyanale, Mimir, Artemis, Vidar, Unseen into `S.scratch` |
| 5 | Overcharge + stun precompute | 1293–1303 | 11 | `overchargeRound`; `fighterStunTurns` (**draws RNG** on additional attacks) |
| 6 | **`doHit` closure** | 1305–1537 | **233** | The swing itself — see breakdown below |
| 7 | Main hit invocation | 1539–1545 | 7 | `mainCritRoll` (**RNG**), `mainCrit`, calls `doHit`, returns on `result` |
| 8 | Post-hit burst procs | 1547–1601 | 55 | Death Charm instakill, Venom Rupture, Hemorrhage — **three early returns** |
| 9 | Additional-attack collection | 1603–1642 | 40 | Builds the Labrys → Glacial Bow → Auto-Fire → Archer list (**RNG** at 1631) |
| 10 | Additional-attack loop | 1644–1655 | 12 | Recurses into `playerAttack` per generated attack |

`doHit` (stage 6) internally:

| Sub-stage | Lines | n | Note |
|---|---|---|---|
| Guard, DEF, crit, variance | 1306–1312 | 7 | **Two RNG draws** |
| Multiplier decision | 1314–1336 | 23 | Produces ~8 interdependent locals |
| Damage roll + Odin bonus + floor | 1337–1362 | 26 | `rolledDamage`, `dmg`, `jarngreiprDmg` |
| Jarngreipr `prepareLandedHit` | 1364–1375 | 12 | Closure mutating three outer locals |
| Apply hit + logging | 1377–1400 | 24 | `applyHitWithReactions`, channel-ordered log |
| Surt / Thunderbolt riders | 1401–1408 | 8 | |
| Lifesteal | 1409–1425 | 17 | Four independent sources |
| `result` early return | 1426–1428 | 3 | |
| Overcharge debuff selection | 1430–1455 | 26 | **RNG** at 1434 |
| Fighter stun + Bash follow-up | 1457–1495 | 39 | **Early return** at 1489 |
| `applyLandedHitPassives` + return | 1496–1499 | 4 | |
| Swordsman bleed stack | 1500–1532 | 33 | Reserved **RNG** at 1509 |
| Pierce flag cleanup | 1533–1536 | 4 | |

---

## 2. Proposed cuts — accepted

Ordered so each is independently committable, smallest blast radius first. The
whole engine works after every step.

### Cut 1 — `applyOverchargeDebuff(S, O)`

- **Lines:** 1434–1454 (21). The `if (mainHit && overchargeFired && !res.negated && O.hp > 0)` guard at 1433 **stays at the call site**, so the trigger condition remains visible where it fires.
- **Does:** selects and applies Overcharge's single debuff (paralyze / burn / def_down / atk_down), logging the result or the resist.
- **Reads:** `S`, `O` (params); `selectOverchargeDebuff`, `tryApplyDebuff`, `logAt`, `findDebuff`, `effAtk`, `LOG`, `LANDED_STAT_DEBUFF_TURNS`, `bt.rng` — all already in `resolveBattle` or module scope.
- **Mutates:** `O.debuffs` (via `tryApplyDebuff`), the `burn.overcharge` marker, the combat log.
- **Verbatim:** yes. No early return, no outer local mutated, RNG draw stays at its call position.

### Cut 2 — `applySwordsmanBleedStack(S, O)`

- **Lines:** 1509–1531 (23). The `if (S.classPassive === 'bleed' && …)` guard at 1508 stays at the call site — it references `res.negated`, which the cut would otherwise have to receive.
- **Does:** adds or refreshes one 4% Bleed stack, capped at five, and logs the current stack.
- **Reads:** `S`, `O`; `findDebuff`, `logAt`, `bt.rng`, `BLEED_*`, `EFFECT_CATEGORY`, `LOG`.
- **Mutates:** `O.debuffs`, the combat log.
- **Verbatim:** yes. The reserved `bt.rng()` at 1509 moves as the first statement, preserving draw order.

### Cut 3 — `consumeNextAttackFlags(S, attackHookEvents)`

- **Lines:** 1260–1292 (33).
- **Does:** consumes the six durable "next attack" grants (Amihan tailwind, Idiyanale, Mimir, Artemis auto-crit, Vidar auto-crit, Unseen) into `S.scratch`.
- **Reads:** `S`, and the `attackHookEvents` array the caller already built at 1258.
- **Mutates:** `S.scratch.playerAtkMult`, `S.scratch.nextAttackAutoCrit`, `S.scratch.ignoreDefPct`, several `S.flags.*`, and pushes into `attackHookEvents`.
- **Verbatim:** yes. Six independent `if` blocks, no early return, no RNG.

### Cut 4 — `collectAdditionalAttacks(S, allowAdditionalAttackProcs)`

- **Lines:** 1607–1642 (36), returning the array; the flag clears at 1640–1642 move with it.
- **Does:** builds the ordered additional-attack list (Labrys → Glacial Bow → Auto-Fire → Archer) and clears the one-shot flags.
- **Reads:** `S`, the `allowAdditionalAttackProcs` local; `bt.rng`, `ARCHER_DOUBLE_ATTACK_CHANCE`, `LOG`.
- **Mutates:** `S.flags.labrys_double_hit`, `extra_turn`, `auto_fire_shot`.
- **Verbatim:** yes. The Archer RNG draw at 1631 keeps its position relative to the three preceding checks — order is what makes it safe.

---

## 3. The honesty test, per cut

| Cut | Reads less after? | Roughly how much less |
|---|---|---|
| 1 — Overcharge debuff | **Yes** | Changing what Overcharge applies means reading ~21 named lines instead of locating them inside a 233-line `doHit` inside a 452-line function. |
| 2 — Swordsman bleed | **Yes** | Bleed stacking is a wholly self-contained mechanic; ~23 lines instead of 452. The guard stays visible at the call site. |
| 3 — Durable flags | **Yes, smaller** | Changing Amihan or Artemis means reading ~33 lines. Honest caveat: these are already six independent 3–5 line blocks, so they were not hard to read — the win is *locating* them, not understanding them. This is the weakest accepted cut. |
| 4 — Additional attacks | **Yes** | "Which extra attacks fire, and in what order" becomes one named function of ~36 lines. Today the answer is split across a collection block and a recursion loop 40 lines apart. |

### Rejected

| Candidate | Lines | Why rejected |
|---|---|---|
| Post-hit burst procs | 1547–1601 (55) | **Three early returns** (1553, 1573, 1598) return from `playerAttack`. Extracting needs a boolean protocol and caller-side checks — not a verbatim move, and the control-flow rewrite is exactly the risk class this project exists to avoid. |
| Fighter stun + Bash | 1457–1495 (39) | **Early return at 1489** (`if (result \|\| O.hp <= 0) return;`) exits `doHit` mid-block. Same problem. |
| Damage multiplier + roll | 1314–1362 (49) | Produces ~10 interdependent locals (`overchargeFired`, `doubled`, `critApplied`, `critLevel`, `surtVsBurning`, `willFighterStun`, `jarngreiprEligible`, `thunderboltTriggered`, `dmg`, `jarngreiprDmg`) that the rest of `doHit` consumes. A cut would return a 10-field object and change nothing about what must be read. Pure shuffle. |
| Lifesteal block | 1409–1425 (17) | Four flat `if`s, already legible, already adjacent. Moving them relocates 17 clear lines and reduces nothing. |
| Context + scratch baseline | 1206–1239 (34) | Produces six locals used throughout the function. Extraction means returning an object and destructuring it — identical reading burden, plus an indirection. |
| Tyrfing execute | 1240–1253 (14) | Early return, and only 14 lines. Not worth a control-flow change. |

---

## 4. What should not be cut

**`doHit`'s core, lines 1306–1400 (~95 lines), stays exactly where it is.** This
is the irreducible part of the attack: guard → DEF → crit roll → variance →
multiplier selection → damage roll → Odin bonus → floor → `prepareLandedHit` →
`applyHitWithReactions` → channel-ordered logging. Every local feeds the next,
and three of them (`fighterStunResolved`, `fighterStunned`, `jarngreiprTriggered`)
are mutated by the `prepareLandedHit` callback *during* the hit and read after
it. There is no seam here that does not require inventing a return protocol.

**Two RNG draws at 1311–1312 anchor the stream.** The crit roll and the variance
roll must stay in this order and at this position; any cut that moves code across
them changes every downstream draw and would fail C1's 150 hashes immediately.

**The `result` early returns stay inline** — 1306, 1426–1428, 1489, 1499, 1545.
They are the battle-over short-circuit, and turning any of them into a returned
flag is a control-flow change, not a move.

---

## 5. Expected result

| | Lines |
|---|---|
| `playerAttack` today | 452 |
| Cut 1 (−21 +1) | −20 |
| Cut 2 (−23 +1) | −22 |
| Cut 3 (−33 +1) | −32 |
| Cut 4 (−36 +1) | −35 |
| **`playerAttack` after** | **~343** |

`doHit` goes 233 → ~189. `resolveBattle` stays roughly the same size overall —
the four closures land in it as siblings, so this redistributes rather than
removes.

**Is the attack path then readable? No. It is shorter and better signposted.**
343 lines is still well past what anyone reads in one sitting, and `doHit` at
~189 lines remains the densest thing in the file. What genuinely improves is
*navigation*: four named mechanics become findable by name instead of by
scrolling, and each can be changed without reading the swing logic around it.

That is a narrower claim than "playerAttack becomes readable," and it is the
honest one. The 95-line core in section 4 is the real complexity, and nothing in
this plan touches it — because nothing safely can.

---

## 6. Recommendation

**Proceed, with these four cuts only.**

Reasoning:

1. **The cuts are in the same provable class as Phase 4.2.** Every accepted body
   moves verbatim, no signature changes, no shared-state ownership changes, and
   C1's 150 hashes plus the ~2,000-battle fuzz gate each commit. The risk is the
   same low risk that made Phase 4 safe, unlike the combat-context project.

2. **Each accepted cut isolates a mechanic someone would actually go looking
   for.** Overcharge's effect, Bleed stacking, the durable-flag grants, and the
   additional-attack roster are all things a balance change targets directly.

3. **But the payoff is bounded and should be expected as such.** 452 → ~343 is a
   24% reduction that leaves the function large. If the goal is "combat becomes
   easy to change," this does not achieve it; if the goal is "four specific
   behaviors become easy to find and change," it does.

4. **Cut 3 is the one to drop if you want fewer.** It is the weakest of the four
   by the honesty test — the six flag blocks were already readable, so it buys
   location rather than comprehension. Cuts 1, 2 and 4 clearly earn their place.

I am not recommending against this plan the way I recommended against the
combat-context project, because the cuts here are cheap, safe, and individually
justified. But the expected result deserves stating plainly rather than selling:
this makes four things easier to find. It does not make the attack path
readable, and no safe refactor of this function will.
