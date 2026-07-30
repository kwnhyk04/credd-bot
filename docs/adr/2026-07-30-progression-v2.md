# ADR: Progression v2 — level cap 100, lifetime_exp, mob-level EXP scaling

**Date:** 2026-07-30 · **Status:** accepted, implemented

Written for someone with no memory of the discussion that produced it. If you are here to
rebalance progression, read "Approved configuration" and "Rejected alternatives" before
changing any number.

---

## Problem

Players leveled far too fast — hardcore players reached level 31 in under a month against
a cap of 50. Separately, `user_character` stored only `combat_level` and `combat_exp` (EXP
*toward the current level*), with no lifetime total, so every past rebalance required a
bespoke data migration.

## Approved configuration

| Element | Value | Where |
|---|---|---|
| Cap | 100 | `MAX_COMBAT_LEVEL`, `src/config/combatExp.js` |
| Levels 1–19 | hand-tuned, fast early game | `EXP_TO_NEXT[0..18]` |
| Levels 20–30 | geometric ×1.06, ending 1,300,000 | `EXP_TO_NEXT[19..29]` |
| Levels 31–50 | growing gap, ending 42,000,000 | `EXP_TO_NEXT[30..49]` |
| Levels 51–99 | `42,000,000 + 1,000,000 × (L − 51)`, topping at 90,000,000 | generated, `combatExp.js` |
| Total to level 100 | **3,630,601,650** | `CUMULATIVE_EXP[99]` |
| Source of truth | `user_character.lifetime_exp` (BIGINT) | level/exp are a derived cache |
| EXP scaling | `baseExp × max(1.0, (level / 30)²)` | `scaleExpForMobLevel`, `src/config/expScaling.js` |
| Pivot / exponent / floor | 30 / 2 / 1.0 | same |
| Mob level ceiling | `MOB_LEVEL_MAX = 120` | `expScaling.js`; roll offset stays −2..+15 |
| Boss EXP basis | the **participant's own level** | `bossSystem.js` → `awardCombatExpMany` |
| Boss attack cap | 2/day, override ceiling `MAX_BOSS_ATTACKS_PER_DAY + 2` | `config/bosses.js`, `bossSystem.js` |

Curve properties that must hold — asserted in `scripts/exp-curve-selftest.js`:

- Non-decreasing, with **exactly one plateau** (level 50 and 51 both cost 42,000,000).
- Every level costs **at least** its pre-v2 amount, equality only at levels 1, 2, 3. This
  is what lets the migration carry `combat_exp` across raw.

## Pacing model and its assumptions

`scripts/exp-pacing-model.js` (`npm run model:exp-pacing`). It imports the curve, the
scaling helper, the loot table and the boss cap from live modules rather than restating
them, so it cannot drift from shipped behaviour.

**Anchor: 300,000 EXP/day** for a top-decile player, observed before v2 when all rewards
were flat. It back-tests: under the *old* curve at 300,000/day, level 31 arrives at 25.5
days against the observed "under a month". Every timing scales inversely with this number.

Composition, which the model scales per-component rather than wholesale (auto-raid and
manual raids scale on **mob** level, bosses on the **participant's** level):

| Source | EXP/day | Share |
|---|---|---|
| Auto-raid, 24h | 216,000 | 72.0% |
| 2 bosses (at the cap) | 47,500 | 15.8% |
| ~122 manual raids (~30 min at the 15s cooldown) | 36,500 | 12.2% |

| Archetype | L50 | L75 | L100 |
|---|---|---|---|
| **Full anchor (canonical)** | 1.29y | 3.68y | **5.56y** |
| Auto-raid + 2 bosses | 1.48y | 4.21y | 6.36y |
| Auto-raid only | 1.72y | 4.95y | 7.49y |
| 2 bosses only | 10.50y | 28.57y | 42.02y |

**An earlier figure of 5.39y circulated. It was not the expected outcome** — it came from
scaling the 300,000/day anchor wholesale instead of decomposing it, which mis-scaled the
boss slice. The canonical number is 5.56y.

**`MOB_LEVEL_MAX` is load-bearing for every timing above.** Left at its pre-v2 value of 55,
a level-100 player fights level-55 mobs for 1,008 EXP/kill instead of 3,790 and level 100
becomes **10.22 years**. Do not treat that constant as cosmetic.

## Rejected alternatives

### Tail shape — chose rising 1,000,000/level

| Rejected | Why |
|---|---|
| Flat 42,000,000 for 51–99 | Inverts difficulty. Under quadratic scaling level 99 takes ~14 days against level 51's ~52, so the endgame *accelerates*. |
| Flat 20,000,000 | Breaks monotonicity — level 51 costs less than level 50, making 50 the hardest level in the game. |
| Rising ~2,100,000/level | Would flatten time-per-level fully, but pushes level 100 past 9 years. |

### Scaling pivot — chose 30 with a 1.0 floor

| Rejected | Why |
|---|---|
| Pivot 36.5 (true neutrality at level 30) | Nerfs the early game to ~0.06×, against the explicit "keep levels 1–10 fast" goal; lengthens all timings ~48%. |
| Unfloored pivot 30 | Same defect, less severe: 0.09× at level 1, 0.33× at level 10. |
| Linear `L/30` | Level 100 stays ~10.4 years even with a flattened tail. |
| `(L/30)^1.5` | Level 100 at 7.3 years — still not reachable content. |

**Consequence, accepted:** v2 is a **strict EXP buff for every player** — nobody earns less
per kill than before — largest (~1.5×) at level 30+. Announce alongside the progress-bar
shrink, since the two land together and read in opposite directions.

### Boss EXP basis — chose the participant's own level

Scaling off the boss's level was rejected: boss level is `AVG(combat_level)` of active
players, so a level-20 player in a level-60 fight would earn 40,000 × 4 = **160,000 EXP,
more than levels 1–20 combined**. Using the participant's own level removes the exploit
rather than clamping around it, and needed no SQL change — `awardCombatExpMany` already
computed per row in JS.

### Boss damper — considered and rejected

A damper (sub-quadratic exponent for the boss path, a daily boss-EXP cap, or
`min(participantLevel, bossLevel)`) was proposed on the strength of a sweep showing
12/48/96 bosses per day driving level 100 to 3.62y / 1.42y / 0.78y.

**Every one of those archetypes is impossible, and the sweep overstated boss throughput
48×.** `MAX_BOSS_ATTACKS_PER_DAY = 2` already constrains it:

| Fact | Detail |
|---|---|
| Constant | `MAX_BOSS_ATTACKS_PER_DAY = 2`, `src/config/bosses.js:20` |
| Decision helper | `bossAttackDecision`, `src/config/bosses.js:73-76` |
| Enforcement | Gate 4, `src/engine/bossSystem.js` (`SUM(attacks)` from `boss_attack_log`) |
| Counts | **attacks, not defeats** — EXP is paid on participation when the boss dies, so actual EXP grants can be *fewer* than 2. A boss that survives your attack costs you the attack and pays nothing. |
| Scope | Global across all spawns and guilds |
| Reset | Lazy comparison against `(NOW() AT TIME ZONE 'Asia/Manila')::date` — no scheduled job; the upsert resets `attacks` to 1 when the stored date differs |

With the real cap, bosses are **13–16% of daily EXP at every level**, and bosses alone
would take 42 years to reach level 100. The damper was rejected; participant-level scaling
stands unmodified.

**The lesson worth keeping, because it is the repeatable mistake:** the sweep read what
each reward *pays* from source but *assumed* how often it could be collected. Verifying
amounts without verifying frequency produces a model that looks source-derived and is
fiction. The same error occurred earlier in this workstream, in a claim that
`autoRaid.computeRewards` "partially self-corrects" the curve — asserted without reading
that it scales window length and payout by the same factor, making EXP/hour level-invariant
at 9,000.

**Coupling to record:** `BOSS_DAILY_ATTACK_LIMIT` previously accepted values up to 100. At
100, bosses become 89% of throughput and level 100 collapses to ~0.7 years — exactly the
scenario the damper analysis dismissed as impossible. The ceiling is now
`MAX_BOSS_ATTACKS_PER_DAY + 2`. **Additive, not multiplicative**: the case it exists for
(granting players a retry after a boss bug) is a fixed quantity, not a proportion, so a
multiplier would scale the blast radius if the design cap ever rose. A startup diagnostic
warns whenever the effective limit differs from the design cap; the ceiling is the guard,
the warning is only visibility.

### Mob levels — chose to keep the offset, raise only the ceiling

Banded offsets (1–79: −2..+15, 80–99: 0..+25, 100: 0..+50) were rejected: they change
difficulty at levels with no live data, and because losses pay 50 EXP instead of 300,
harder mobs would silently tax the endgame rate the model just established. The existing
−2..+15 offset is already balanced against linear mob and class stat scaling, so relative
difficulty at level 100 vs 115 mobs matches level 30 vs 45 today. `MOB_LEVEL_MAX = 120`
rather than 150 because the highest reachable mob level is 115 (cap 100 + max offset), and
`scaleExpForMobLevel` clamps against this constant — 150 would make that reward-inflation
bound meaninglessly loose.

### Migration — chose to preserve level and raw EXP

`lifetime_exp = CUMULATIVE_EXP[level - 1] + combat_exp`. Level and `combat_exp` are written
back unchanged.

| Rejected | Why |
|---|---|
| Recompute levels from earned EXP | Drops every player 3–5 levels. |
| ×1.64 EXP grant to compensate | Protects only top players; mid-levels still drop. |

Progress bars **shrink** as a result — the same EXP is a smaller fraction of a larger
requirement (level 31 with 500,000 EXP goes 34.5% → 23.8%). This is intended and must not
be "corrected".

### Aegis third stack — chose 20% effective maximum

The third Stone stack becomes the Petrify: stacks reset and the accrued reduction is rolled
back in the same step, so two stacks (20%) is the ceiling. 30% was rejected — stacking
reduction *plus* a Petrify would make Aegis strictly better than Mail of Brokkr's flat 30%.

### Invariant enforcement — chose preflight plus a startup soft warning

A cron job was rejected: a scheduler, a failure mode and alert noise are not worth it for an
invariant only two code paths can break. The full per-row scan lives in
`scripts/production-preflight.js`; boot runs one cheap aggregate that warns (never throws)
when a row has progress but `lifetime_exp = 0`.

### Reward caps — split per kind, combat deliberately still 50

`MAX_COMBAT_REWARD_LEVEL` and `MAX_BELIEVER_REWARD_LEVEL` replaced the single shared
constant. A shared cap raised to 100 would push believer levels 51–100 into the INSERT in
`grantLevelRewardsFor`, violate `believer_level_rewards`' `CHECK (level BETWEEN 2 AND 50)`,
throw, and roll back the believer EXP grant.

**The combat cap stays 50 even though the level cap is 100.** `grantLevelRewardsFor`
INSERTs its exactly-once tracking rows *before* computing the reward, so raising it while
`COMBAT_REWARD_BRACKETS` still stops at 50 would mark levels 51–100 as granted while paying
nothing — and the deferred brackets PR could then never pay them. **Raise it in the same
change that adds the brackets, not before.**

## Known accepted tradeoffs

| Tradeoff | Detail |
|---|---|
| Residual difficulty inversion | Time per level still declines across the tail (~39 days at L51 → ~25 at L99, a 1.76× inversion). Removing it needs ~2,100,000/level and costs 4 more years to the cap. |
| The L50/L51 plateau | Both cost 42,000,000. Benign — non-decreasing still holds — and pinned by a selftest so a future edit cannot break the tie unnoticed. |
| int8 parser blast radius | `src/db/pool.js` maps OID 20 to a JS number **repo-wide**, so every BIGINT column now arrives as `number` instead of `string`. Verified against the live DB (not the committed dump, which was stale at 37 vs 40 columns): all 40 are economy/stat counters, surrogate PKs, or internal `avatar_id` keys. **Zero are Discord snowflakes** — every `discord_id`, `guild_id`, `channel_id`, `message_id` is `character varying(20)`. Snowflakes exceed `MAX_SAFE_INTEGER` by ~137× and *would* be silently rounded, so re-run that query before adding any BIGINT column that could hold an ID. |
| `MAX_SAFE_INTEGER` bound | Values above 9,007,199,254,740,991 round. The curve tops out at 3.63e9, but `users_bag.credux` and `lifetime_credux_earned` are unbounded accumulators — the pair to watch long-term. |
| Early-game slowdown | The 1.0 scaling floor means no per-kill nerf, but the curve itself is ~4× steeper through level 20 than pre-v2. |

## Known risk: dev-spawned bosses bypass the daily cap in production

Gate 4 is skipped entirely for dev-spawned bosses (`bossSystem.js`, keyed off the in-memory
`devSpawns` set populated by `crd dev spawnboss`), and those spawns never consume a daily
lock.

**Verified guard tier: token-confirmation only, not `destructiveProductionDenied()`.**
`spawnboss` uses `liveEventGuardMessage` → `productionConfirmationMessage`, which in
production requires only the exact token `confirm:SPAWN_BOSS:<guildId>`; it is absent from
`DESTRUCTIVE_SUBCOMMANDS`. So this is **reachable in production, not contained to test
environments.** The mitigation is that the whole `crd dev` surface sits behind superuser
middleware, so no ordinary player can open the bypass — but once a superuser spawns a test
boss on a live guild, that boss is a public object and **any player who attacks it farms
unlimited EXP**. The bypass is process-local: a restart clears `devSpawns`.

**Recommended fix, not yet applied:** key the `isDev` bypass on the *attacker* being a
superuser rather than on the spawn. That preserves smoke-testing including the reward path
while sending every other attacker through the normal cap.

## Deferred

| Item | Note |
|---|---|
| Reward brackets 51–100 | Economy decision. Levels 51+ grant nothing meanwhile — verified safe: `clampRange` returns null before the INSERT, so no row is written and no CHECK is touched. Raise `MAX_COMBAT_REWARD_LEVEL` in the same change. |
| Banded mob offsets | Revisit as a tuning pass once players actually reach the 70s. |
| Scoping the Gate 4 bypass to superuser attackers | See the risk above. |

## Verification

```bash
npm run selftest:full && npm run model:exp-pacing
```

Migration, against a restored copy first — never straight at production:

```bash
node scripts/progression-v2-migrate.js --dry-run
```

Apply `scripts/migrations/20260730_01_progression_v2.sql` via `psql`, re-run the dry run,
then `--execute`, then re-run the dry run once more to confirm the idempotency guard
short-circuits. Reverse is `20260730_02_progression_v2_rollback.sql`, which refuses to run
if any player has passed level 50 rather than demoting real progress.
