# Combat context — design proposal

Proposal only. No code has been written and nothing under `src/` has been
changed. This document exists to let a decision be made about whether the
"combat context" project should run at all.

All line references are against `src/engine/battleEngine.js` at commit
`d9a8183`, where `resolveBattle` spans lines 588–2270 (1,683 lines) and declares
43 closures. Coupling claims were produced by a brace-matching call-graph
analysis run under node, then spot-checked by reading the source; they were not
taken from text search.

**Bottom line up front: the recommendation in section 8 is to _drop_ this
project as scoped.** The context object does not remove the coupling it targets,
and it does not touch the thing that actually makes combat hard to change.

---

## 1. Problem statement

### What "coupled" actually means here

The shared state is not one thing. It is four, and they have different
characters:

| State | Declared | Kind | Why it matters |
|---|---|---|---|
| `shared.events` | inside `shared` | `CombatLog` instance | Stateful, order-sensitive, positionally addressed |
| `shared.round` | inside `shared` | number, mutated | Read by stun/immunity windows |
| `result` | line 887 | **reassignable `let`** | Battle-over sentinel and control flow |
| `bt` | line 647 | const object of const objects | Already hoisted in Phase 4.1 |

The `bt` handle introduced in Phase 4.1 works precisely because `A`, `B`,
`totals`, `shared`, `moonState` are all `const` objects mutated in place, and
`rng` is a stable function reference. `result` is none of those — it is
reassigned at line 893 — which is exactly why it was left out of `bt`. Any
extraction of `act` collides with this immediately: `act` opens with
`if (result) return;` at line 1708.

### Closures that own or mutate `shared` / the event log

Nineteen closures write to the event log. The ones that matter for the three
targets:

| Closure | Lines | What it does | Used by |
|---|---|---|---|
| `logAt` | 649 | Pushes under an explicit priority via `events.at()` | all three |
| `addDebuff` | 729–775 | Applies a debuff; logs; reads `shared.round`; draws RNG | `playerAttack`, `act` |
| `tryApplyDebuff` | 776–796 | Immunity-gated `addDebuff`; logs the block | `playerAttack`, `act` |
| `canApplyFighterStun` | 797–801 | Reads `shared.round` for the stun-lock window | `playerAttack` |
| `win` | 888–914 | **Sets `result`**; flips log channel to `DEFEAT`, emits, flips back to `STATUS` | via `checkDeaths` |
| `checkDeaths` | 916–921 | Reads `result`, calls `win`, returns battle-over boolean | `playerAttack`, `act` |
| `applyHitWithReactions` | 1082–1090 | **Splices a positional range out of the log** | `playerAttack`, `mobAttack` |
| `applyLandedHitPassives` | 1093–1160 | Post-hit passive lane; logs; draws RNG | `playerAttack` |
| `recordReceivedCrit`, `grantValkyrieResolve`, `grantAegisStone`, `armLowHpAttackPassives` | 986–1070 | Defender reaction lane; all log | via `applyHitToDefender` |

Reachability for the three targets, computed from the call graph:

| Target | Lines | Direct calls | Transitively reachable | Of those, touching log/round |
|---|---|---|---|---|
| `playerAttack` | 1205–1656 (**452**) | 16 | 19 | 7 |
| `mobAttack` | 1659–1705 (47) | 4 | 4 | 2 |
| `act` | 1707–1792 (86) | 8 | 23 | 9 |

`act` calls `playerAttack` and `mobAttack` (lines 1788/1790); both re-enter
`applyHitToDefender` through `applyHitWithReactions`. So the three are one
mutually-reachable unit, not three separable functions.

### The log is not a list

This is the part that decides the whole proposal. `CombatLog`
(`src/engine/combatLog.js`, 238 lines) is not an array of strings:

- It has a **mutable `channel`** (getter/setter, lines 129/131). `win` sets it
  to `DEFEAT` at line 892 and restores it to `STATUS` at 913. `act` sets it to
  `CLASS` at line 1711. Log placement therefore depends on ambient state at
  the moment of the call.
- `at(priority, fn)` (line 156) runs a callback under a scoped priority
  override.
- `applyHitWithReactions` reads `events.length` (1083), runs the defender stack,
  then **`splice(reactionStart)`** (1088) to lift out exactly the entries that
  callback produced — positional surgery that assumes append-only behavior
  during the call.
- A reordering pass (`orderEvents`, ~line 191 onward) rewrites final order by
  segment.

So "the log" is a stateful buffer with an ambient mode, scoped overrides,
positional extraction, and a post-hoc sort.

### Evidence from 4.3: why the mechanical path stops

Phase 4.3 attempted `applyHitToDefender(bt, S, O, dmg, info)` exactly as
specified. C1 rejected it immediately with
`ReferenceError: effectDamage is not defined`. The body needed 12 closure-bound
helpers that `bt` does not carry. The fix that shipped bundles them into an `fx`
object passed alongside `bt`.

That worked — 244 lines moved to module scope, all gates green — but it is worth
being clear about what it bought. `applyHitToDefender` is now *lexically* at
module scope while remaining *semantically* unable to run without twelve
closures that own `shared` and the log. The coupling moved across the call
boundary; it did not decrease. For the three remaining targets the same trick
scales badly: `act` reaches 23 closures, and an `fx` of that size is not a
design, it is a scope object with extra syntax.

---

## 2. Proposed design

### The context object

A `CombatContext` owning what `bt` owns plus the two things it cannot: the log
and the battle-over sentinel.

```
CombatContext
  state:  A, B, totals, moonState, rng, round
  log:    the CombatLog instance
  result: { winner, outcome, causeOfDeath } | null    // was the `let` at 887

  methods:
    log.at(priority, fn)            // wraps the existing scoped override
    log.capture(fn) -> entries      // replaces the length/splice pair at 1083–1088
    finish(side, outcome, cause)    // was `win`
    checkDeaths(outcome, cause)     // reads ctx.result, calls finish
    isOver()                        // replaces `if (result) return`
```

`capture(fn)` is the one genuinely new idea: it turns the implicit
`length`-then-`splice` protocol into a named operation, so the reaction-extraction
contract stops being an invariant a reader has to reconstruct from two lines
thirty apart.

Lifecycle: constructed once per `resolveBattle` call after both sides are built,
passed by reference to every extracted function, discarded when the sim object is
returned. One instance per battle; never shared across battles; never stored.

### What the three functions look like after

```
// module scope
const act = (ctx, S) => {
  if (ctx.isOver()) return;
  ctx.log.channel = LOG.CLASS;
  const O = ctx.oppOf(S);
  ...
  if (ctx.checkDeaths('paralyze', { type: 'dot', source: 'Paralyze' })) return;
  ...
  if (S.kind === 'player') playerAttack(ctx, S, O);
  else mobAttack(ctx, S, O);
};

const mobAttack = (ctx, S, O) => { ... };
const playerAttack = (ctx, S, O) => { ... };   // still 452 lines
```

Compare against today, lines 1707–1712:

```
const act = (S) => {
  if (result) return;
  bt.shared.events.channel = LOG.CLASS;
  const O = oppOf(S);
```

That is the honest before/after. `result` becomes `ctx.isOver()`,
`bt.shared.events` becomes `ctx.log`, and free helpers become `ctx.` members.
The body is otherwise the same body.

---

## 3. Honest simplicity assessment

**A developer changing combat behavior afterwards reads very slightly less, and
in some respects more. This project does not deliver a readability win.**

Specifics:

- `playerAttack` is **452 lines** and stays 452 lines. It is by a wide margin
  the hardest thing in this file to change, and the context object does nothing
  to it. Anyone modifying attack behavior reads the same 452 lines before and
  after.
- The three functions total 585 lines of the 1,683 in `resolveBattle`. Moving
  them out shrinks `resolveBattle` to roughly 1,100 lines — but those 585 lines
  still exist and still have to be read; they are one scroll position away
  instead of nested.
- What genuinely improves: a reader can see the full input surface of `act` from
  its signature instead of inferring it from 23 reachable closures. That is a
  real benefit and it is not nothing.
- What genuinely worsens: every call site gains a `ctx.` prefix, and one
  indirection is added between the reader and every helper. This is the same
  cost the `bt` rename already imposed in 4.1, applied to 585 more lines.

Net: a modest structural gain, a modest legibility loss, and no change at all to
the function that actually needs help.

---

## 4. Why this is riskier than phases 1–4

Phases 1–3 were file moves. Phase 4 was scope moves with verbatim bodies —
provable by diffing trimmed line sequences, which is what was done at each
commit. This project changes semantics of shared state, so that proof technique
stops being available.

| Risk | How it bites | Caught? |
|---|---|---|
| **Log line ordering** | `channel` is ambient (892/913/1711). Wrapping it in a method changes *when* it is set/restored relative to pushes. | **Yes, by C1** — the sim JSON it hashes includes the log, so ordering diffs surface. Best-covered risk. |
| **Positional log surgery** | `applyHitWithReactions` splices by index (1083/1088). Any extra entry pushed inside the captured region silently changes what gets extracted. | **Partly.** C1 catches it only if final ordering differs. A capture grabbing one entry too many can still re-sort to the same final order. |
| **Mutation timing** | `win` sets `result` at 893 *before* pushing its messages. Moving that into `finish()` risks reordering the set against the push. | **Yes, by C1** — but only because a wrong order changes emitted text. A timing change with identical output is invisible and would be a latent bug. |
| **Evaluation order** | `checkDeaths` short-circuits on `result` (917) and A-before-B (918/919). §35.3 first-to-0 ordering depends on it; simultaneous deaths are decided here. | **Weakly.** Only if a seeded case actually produces a simultaneous death. Not deliberately covered. |
| **Aliasing** | `ctx.state.A` must stay the same object as today's `A`. If any step copies rather than references, mutations silently split. | **Yes, immediately** — the sim would diverge grossly on the first hit. Low risk, high visibility. |
| **RNG draw ordering** | 8 closures draw from `bt.rng`. Reordering, adding, or removing a draw shifts the whole downstream stream. | **Yes for shifts, no for swaps.** A shift changes everything and C1 screams. Two draws *swapped* between equal-probability branches can produce identical outcomes for the 150 sampled seeds and differ on the 151st. |

The two genuinely under-covered risks are **capture-region drift** and **RNG
draw swaps**. Both can pass all 150 hashes and still be wrong.

---

## 5. Required safety net before any code is written

**The current net is not sufficient for a redesign.** It is excellent for
verbatim moves — which is what it was built for, and why phases 1–4 were safe —
and it is thin in exactly the places a redesign perturbs.

Current: C1 is 50 seeds × 3 modes = 150 cases (`SEEDS_PER_MODE = 50`,
`MODES = ['raid','duel','boss']`, harness lines 31–32), each hashing
`JSON.stringify(sim)`. Plus ~2,000 seeded fuzz battles in `battle-selftest.js`
asserting invariants, and scripted-RNG scenarios for exact math.

Gaps:

1. **150 cases is a small sample of the configuration space.** Seeds vary the
   RNG stream, not the fighters. Equipment, passives, class, blessings, and boss
   identity are near-fixed across the 150.
2. **Nothing asserts RNG draw sequence.** Two swapped draws are invisible.
3. **Nothing asserts log ordering independently of final text.** The final hash
   conflates content and order.
4. **Edge cases are sampled, not targeted.** Simultaneous death, lethal-hit
   heal, and debuff expiry-on-death appear only if a seed happens to produce
   them.

### Harnesses to build first

| # | Harness | What it pins | Effort |
|---|---|---|---|
| 1 | **RNG draw-sequence recorder** — wrap `rng`, record every draw with a call-site tag, hash the sequence | Catches draw swaps and added/removed draws that final-state hashing misses | ~half a day |
| 2 | **Log-order snapshot** — assert the full ordered `(priority, text)` sequence per battle, separate from the sim hash | Separates ordering regressions from content regressions | ~half a day |
| 3 | **Capture-region assertion** — assert which entries `applyHitWithReactions` extracts, by count and identity | Directly covers the splice contract, the least-covered risk | ~half a day |
| 4 | **C1 expansion to a configuration matrix** — 50 → 200 seeds, crossed with class × weapon/armor passive × blessing × boss identity | Widens the sample from 150 to low thousands of cases | ~1 day, plus baseline regeneration |
| 5 | **Deliberate edge-case suite** — hand-built scripted-RNG scenarios: simultaneous death, lethal hit with lifesteal/heal, death during DOT, stun expiry into immunity window, debuff expiry on the killing blow, boss phase transition on a lethal hit, immunity vs `no_immunities` | Targets the semantics most likely to shift | ~1–2 days |

Total: roughly **3–4 days of harness work before the first production line is
written.** Items 1–3 are non-negotiable; without them the redesign is blind in
exactly its riskiest dimensions.

Harness 4 requires regenerating C1 baselines, which under the standing rules is
a deliberate, separately-approved act — it cannot be folded into a refactor step.

---

## 6. Migration path

Every step ends green: all gates pass, tree clean, one commit.

| Step | Change | Kind |
|---|---|---|
| 0 | Build harnesses 1–5. No production change. | net only |
| 1 | Introduce `CombatContext` wrapping the existing `shared`, holding the *same* log instance. `bt` keeps working. Nothing uses ctx yet. | design |
| 2 | Move `result` into `ctx.result`; rewrite the three readers (887/1708/917) to `ctx.isOver()`. | **design** — removes a reassignable binding |
| 3 | Add `ctx.log.capture(fn)`; rewrite `applyHitWithReactions` (1082–1090) to use it. | **design** — riskiest single step |
| 4 | Convert `win`/`checkDeaths` to `ctx.finish`/`ctx.checkDeaths`. | design |
| 5 | Extract `mobAttack` (47 lines, 4 deps) to module scope taking `(ctx, S, O)`. | move + signature |
| 6 | Extract `playerAttack` (452 lines) to `(ctx, S, O)`. | move + signature |
| 7 | Extract `act` to `(ctx, S)`. | move + signature |
| 8 | Delete `bt` and `fx`; fold both into ctx; update `applyHitToDefender`. | design |

Old and new coexist through steps 1–4: `ctx` wraps the same objects `bt`
references, so both handles are live and consistent simultaneously. That is what
makes the sequence incremental rather than a big-bang rewrite. From step 5 the
extracted functions use `ctx` exclusively.

Steps 5–7 are the only ones resembling phases 1–4. Steps 2, 3, and 8 are real
design changes where verbatim-diff proof does not apply and the new harnesses
are the only evidence.

---

## 7. Rollback and abort criteria

**Abort signals:**

- Any C1 hash differs and the cause is not immediately and completely
  understood. Under the standing rules this already means stop; here it should
  mean stop *the project*, not just the step — a redesign producing an
  unexplained diff means the model of the system is wrong.
- Step 3 (`capture`) cannot be made hash-identical within two attempts. That
  step is load-bearing; if the splice contract cannot be reproduced exactly, the
  remaining steps are not safe.
- Harnesses 1–3 reveal that current behavior depends on draw or ordering details
  nobody intended. That is a bug discovery, and per standing rules it gets
  reported, not fixed — but it also means "preserve behavior exactly" is
  preserving something nobody designed.
- Cumulative effort passes roughly 2× estimate with steps 5–7 not yet started.

**Recovery per stage:** each step is one commit, so `git revert <sha>` returns to
the previous green state. Steps 1–4 are independently revertible since old and
new paths coexist. Steps 5–7 must be reverted in reverse order (7→6→5) because
each depends on the ctx surface the previous established. Step 0 touches no
production code, so it never needs reverting and the harnesses stay valuable
even if the project is abandoned.

Tag before starting; the branch is not a restore point on its own.

---

## 8. Recommendation

**Drop this project as scoped. Keep step 0.**

Reasoning:

1. **It does not fix the stated problem.** The goal is that combat becomes
   easier to change. What makes combat hard to change is `playerAttack` at 452
   lines, and this project leaves it at 452 lines in a different location.

2. **It relocates coupling rather than removing it — the same criticism that
   correctly stopped the `fx` bag.** A `ctx` carrying the log, the sides, the
   RNG, the round, the result, and a dozen behaviors is the current closure
   scope with a name. Passing it explicitly makes the dependency visible, which
   is worth something, but visibility is not decoupling. If the `fx` bag was not
   good enough to continue with — and it wasn't — a larger, better-named bag
   deserves the same skepticism.

3. **The risk profile inverted.** Phases 1–4 were safe because verbatim moves
   are mechanically provable and C1 was a genuine net. Here the two worst risks
   — capture-region drift and RNG draw swaps — are precisely the ones C1 cannot
   see, which is why 3–4 days of harness work is a precondition. Spending that
   to enable a change whose readability payoff is "modest gain, modest loss" is
   a poor trade.

4. **Phase 4 already banked most of what was available.** `resolveBattle` went
   1,919 → 1,683 lines and `applyHitToDefender` is out. That was the cheap, safe
   portion. The remainder is expensive and unsafe, which is a normal shape for
   refactoring work and a reasonable place to stop.

**What to do instead, in priority order:**

- **Build harnesses 1–3 anyway** (~1.5 days). They have standalone value: they
  strengthen the net for ordinary balance changes and would catch classes of bug
  the current suite cannot see, regardless of any refactor.
- **If combat legibility is the real goal, target `playerAttack` directly.** A
  452-line function is worth decomposing on its own merits, inside
  `resolveBattle`, without touching shared-state ownership. Smaller,
  independently valuable, much better risk/benefit, and it addresses what
  actually hurts.
- **Revisit the context object only if** a future feature genuinely needs combat
  resolution callable from outside `resolveBattle` — simulation preview, replay,
  multi-stage battles. Then the context earns its cost by enabling something
  rather than by promising tidiness.

I am recommending against my own proposal because the honest assessment in
section 3 does not support it. The design is sound; the payoff does not justify
the risk.
