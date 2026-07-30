'use strict';

/**
 * combatExp.js — Combat Level EXP curve (Progression v2, authoritative table).
 *
 * SOURCE OF TRUTH going forward is user_character.lifetime_exp: total EXP ever earned.
 * combat_level and combat_exp are DERIVED from it and are kept in sync as a cache, so
 * the next rebalance is a table swap here rather than another data migration. See
 * scripts/progression-v2-migrate.js for the one-time conversion.
 *
 * combat_exp remains WITHIN-LEVEL progress ("EXP toward next combat level"), mirroring
 * believer_exp. EXP_TO_NEXT[i] is the cost of going level i+1 → i+2. At the cap, exp
 * keeps accumulating within level 100 but never levels.
 *
 * ── Curve shape ─────────────────────────────────────────────────────────────────
 *   1-19   hand-tuned for a fast early game
 *   20-30  geometric ramp x1.06, ending at 1,300,000
 *   31-50  growing gap, ending at 42,000,000
 *   51-99  42,000,000 + 1,000,000 x (L - 51), topping out at 90,000,000
 *
 * The 51-99 tail is GENERATED, not written out, so retuning it is one line rather than
 * 49 literals to re-audit. It rises rather than sitting flat because EXP scales
 * quadratically with level (see expScaling.js): a flat 42,000,000 tail would make level
 * 99 take ~14 days against level 51's ~52, so the endgame would ACCELERATE. The rising
 * gap cuts that inversion from ~3.5x to 1.76x. Removing it entirely needs ~2,100,000
 * per level and pushes level 100 past 9 years, which was rejected.
 *
 * Total EXP to reach level 100: 3,630,601,650 (exceeds int32 — the column is BIGINT,
 * and src/db/pool.js registers an int8 parser so JS-side arithmetic is safe).
 *
 * ── Migration safety invariant ──────────────────────────────────────────────────
 * Every level costs at least as much as it did under the pre-v2 table (equality only at
 * levels 1, 2, 3). That is what lets the migration carry combat_exp across raw: a
 * player's stored within-level EXP can never exceed the new requirement, so nobody
 * lands on an already-completed bar. OLD_EXP_TO_NEXT lives in the migration script and
 * exp-curve-selftest.js asserts the invariant; do not reintroduce it here.
 */

const MAX_COMBAT_LEVEL = 100;

// Levels 1-50: authored values, verbatim. Index i = cost of level i+1 → i+2.
const EXP_TO_NEXT = [
  100, 250, 500, 1000, 1800, 3000, 5000, 8000, 12000, 20000,
  30000, 45000, 65000, 95000, 140000, 200000, 290000, 420000, 600000, 700000,
  745000, 790000, 840000, 895000, 950000, 1010000, 1075000, 1145000, 1215000, 1300000,
  2100000, 3300000, 4600000, 6000000, 7500000, 9100000, 10800000, 12600000, 14500000, 16500000,
  18600000, 20800000, 23100000, 25500000, 28000000, 30600000, 33300000, 36100000, 39000000, 42000000,
];

// Levels 51-99: 42,000,000 + 1,000,000 x (L - 51). L51 ties L50 at 42,000,000 (the one
// plateau in the curve — benign, and asserted in the selftest so a future edit that
// breaks the tie is caught), rising to 90,000,000 at L99.
const TAIL_BASE = 42_000_000;
const TAIL_GAP = 1_000_000;
for (let level = 51; level <= MAX_COMBAT_LEVEL - 1; level += 1) {
  EXP_TO_NEXT.push(TAIL_BASE + TAIL_GAP * (level - 51));
}
Object.freeze(EXP_TO_NEXT);

/**
 * CUMULATIVE_EXP[n] = total EXP needed to REACH level n+1, i.e. the sum of
 * EXP_TO_NEXT[0..n-1]. So CUMULATIVE_EXP[level - 1] is the lifetime EXP at which a
 * player arrives at `level` with an empty bar. Length MAX_COMBAT_LEVEL (index 0..99).
 */
const CUMULATIVE_EXP = [0];
for (let i = 0; i < EXP_TO_NEXT.length; i += 1) {
  CUMULATIVE_EXP.push(CUMULATIVE_EXP[i] + EXP_TO_NEXT[i]);
}
Object.freeze(CUMULATIVE_EXP);

/**
 * EXP_REQUIRED[L] = cost of L → L+1, keyed 1..MAX_COMBAT_LEVEL-1.
 * Retained as a derived view of EXP_TO_NEXT so existing callers (profile.js, stats.js,
 * applyCombatExp) keep working unchanged. Do not edit — edit EXP_TO_NEXT.
 */
const EXP_REQUIRED = Object.freeze(
  EXP_TO_NEXT.reduce((acc, cost, i) => { acc[i + 1] = cost; return acc; }, {}),
);

/**
 * Apply a combat-EXP gain to (level, within-level exp).
 * Returns { level, exp, leveledUp } — multi-level jumps supported.
 */
function applyCombatExp(level, exp, gain) {
  let lv = Math.max(1, Math.min(MAX_COMBAT_LEVEL, Number(level) || 1));
  let xp = (Number(exp) || 0) + Math.max(0, Number(gain) || 0);
  const startLevel = lv;
  while (lv < MAX_COMBAT_LEVEL && xp >= EXP_REQUIRED[lv]) {
    xp -= EXP_REQUIRED[lv];
    lv += 1;
  }
  return { level: lv, exp: xp, leveledUp: lv > startLevel };
}

/**
 * Total lifetime EXP represented by a (level, within-level exp) pair.
 * This is the migration's entire conversion: level and exp are preserved exactly and
 * only the derived total is computed.
 */
function lifetimeExpFor(level, expCurrent) {
  const lv = Math.max(1, Math.min(MAX_COMBAT_LEVEL, Number(level) || 1));
  const xp = Math.max(0, Number(expCurrent) || 0);
  return CUMULATIVE_EXP[lv - 1] + xp;
}

/**
 * Inverse of lifetimeExpFor: derive { level, exp } from a lifetime total.
 * Clamps at MAX_COMBAT_LEVEL, so excess EXP at the cap accumulates within level 100
 * and never overflows to 101.
 */
function levelFromLifetimeExp(lifetimeExp) {
  const total = Math.max(0, Number(lifetimeExp) || 0);
  let lv = 1;
  while (lv < MAX_COMBAT_LEVEL && total >= CUMULATIVE_EXP[lv]) {
    lv += 1;
  }
  return { level: lv, exp: total - CUMULATIVE_EXP[lv - 1] };
}

module.exports = {
  MAX_COMBAT_LEVEL,
  EXP_TO_NEXT,
  CUMULATIVE_EXP,
  EXP_REQUIRED,
  applyCombatExp,
  lifetimeExpFor,
  levelFromLifetimeExp,
};
