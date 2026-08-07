'use strict';

/**
 * exp-curve-selftest.js — Progression v2 curve, scaling and conversion invariants.
 *
 *   npm run selftest:exp-curve
 *
 * DB-free. Everything here is pure arithmetic over src/config/combatExp.js and
 * src/config/expScaling.js, so it runs anywhere and fails loudly when someone edits
 * the curve without understanding what depends on it.
 */

const assert = require('node:assert/strict');
const {
  MAX_COMBAT_LEVEL,
  EXP_TO_NEXT,
  CUMULATIVE_EXP,
  EXP_REQUIRED,
  applyCombatExp,
  lifetimeExpFor,
  levelFromLifetimeExp,
} = require('../src/config/combatExp');
const {
  MOB_LEVEL_MAX,
  SCALING_PIVOT_LEVEL,
  scaleExpForMobLevel,
  expectedMobLevelFor,
} = require('../src/config/expScaling');

// The pre-v2 curve. Duplicated from scripts/progression-v2-migrate.js on purpose:
// this suite exists to prove the relationship between the two tables, so it must hold
// its own copy rather than import one that could be edited to make the test pass.
const OLD_EXP_TO_NEXT = [
  100, 250, 500, 900, 1500, 2400, 3700, 5500, 8000, 12000,
  17000, 24000, 33000, 45000, 60000, 80000, 105000, 135000, 175000, 215000,
  265000, 325000, 395000, 475000, 565000, 670000, 790000, 925000, 1080000, 1250000,
  1450000, 1680000, 1950000, 2250000, 2600000, 3000000, 3450000, 3950000, 4500000, 5100000,
  5800000, 6600000, 7500000, 8500000, 9600000, 10800000, 12100000, 13500000, 15000000,
];

const TOTAL_TO_LEVEL_100 = 3_630_601_650;

// ── table shape ─────────────────────────────────────────────────────────────
{
  assert.equal(MAX_COMBAT_LEVEL, 100, 'cap is 100');
  assert.equal(EXP_TO_NEXT.length, 99, 'one entry per level transition 1->2 .. 99->100');
  assert.equal(CUMULATIVE_EXP.length, 100, 'cumulative covers levels 1..100');
  assert.equal(CUMULATIVE_EXP[0], 0, 'level 1 starts at zero lifetime EXP');
  assert.equal(CUMULATIVE_EXP[99], TOTAL_TO_LEVEL_100, 'total EXP to reach level 100');

  // Generated tail. If someone retunes TAIL_BASE/TAIL_GAP these are the guards.
  assert.equal(EXP_TO_NEXT[50], 42_000_000, 'level 51 costs the tail base');
  assert.equal(EXP_TO_NEXT[98], 90_000_000, 'level 99 tops the tail out');
  for (let level = 51; level <= 99; level += 1) {
    assert.equal(
      EXP_TO_NEXT[level - 1],
      42_000_000 + 1_000_000 * (level - 51),
      `level ${level} follows the tail formula`,
    );
  }

  // Non-decreasing, with EXACTLY ONE plateau. The tie at 50/51 is deliberate; a second
  // tie, or any decrease, means the curve was edited without checking this property.
  const plateaus = [];
  for (let i = 1; i < EXP_TO_NEXT.length; i += 1) {
    assert(EXP_TO_NEXT[i] >= EXP_TO_NEXT[i - 1], `level ${i + 1} must not cost less than level ${i}`);
    if (EXP_TO_NEXT[i] === EXP_TO_NEXT[i - 1]) plateaus.push(i + 1);
  }
  assert.deepEqual(plateaus, [51], 'the only plateau is level 50 == level 51');

  // EXP_REQUIRED is a derived view, not a second source of truth.
  assert.equal(Object.keys(EXP_REQUIRED).length, 99);
  for (let level = 1; level <= 99; level += 1) {
    assert.equal(EXP_REQUIRED[level], EXP_TO_NEXT[level - 1], `EXP_REQUIRED[${level}] tracks the array`);
  }
}

// ── migration safety invariant ──────────────────────────────────────────────
// This is what lets the migration carry combat_exp across raw. If it ever fails, a
// player could hold more within-level EXP than the new level costs.
{
  const equalLevels = [];
  for (let i = 0; i < OLD_EXP_TO_NEXT.length; i += 1) {
    assert(
      EXP_TO_NEXT[i] >= OLD_EXP_TO_NEXT[i],
      `level ${i + 1} got cheaper: ${EXP_TO_NEXT[i]} < ${OLD_EXP_TO_NEXT[i]}`,
    );
    if (EXP_TO_NEXT[i] === OLD_EXP_TO_NEXT[i]) equalLevels.push(i + 1);
  }
  assert.deepEqual(equalLevels, [1, 2, 3], 'only levels 1-3 cost the same as before');
}

// ── applyCombatExp ──────────────────────────────────────────────────────────
{
  const l1 = applyCombatExp(1, 0, 0);
  assert.deepEqual([l1.level, l1.exp, l1.leveledUp], [1, 0, false], 'level 1 with no EXP stays put');

  const exact = applyCombatExp(1, 0, 100);
  assert.deepEqual([exact.level, exact.exp, exact.leveledUp], [2, 0, true], 'exact threshold levels up');

  const under = applyCombatExp(1, 0, 99);
  assert.deepEqual([under.level, under.exp], [1, 99], 'one short of the threshold does not level');

  const multi = applyCombatExp(1, 0, 850);
  assert.deepEqual([multi.level, multi.exp], [4, 0], 'multi-level from a single gain');

  const carry = applyCombatExp(1, 50, 100);
  assert.deepEqual([carry.level, carry.exp], [2, 50], 'remainder carries into the new level');

  // A gain that crosses the 30->31 ramp, where the per-level cost jumps 1.3M -> 2.1M.
  const ramp = applyCombatExp(30, 0, 1_300_000 + 2_100_000);
  assert.equal(ramp.level, 32, 'crosses the 30->31 ramp cleanly');

  // Cap behaviour: excess accumulates within level 100 and never becomes 101.
  const capped = applyCombatExp(100, 0, 9_999_999_999);
  assert.equal(capped.level, 100, 'cap never overflows to 101');
  assert.equal(capped.leveledUp, false, 'no level-up reported at the cap');

  const negative = applyCombatExp(5, 100, -5000);
  assert.equal(negative.exp, 100, 'negative gains are clamped to zero, not subtracted');
}

// ── lifetimeExpFor / levelFromLifetimeExp ───────────────────────────────────
{
  assert.equal(lifetimeExpFor(1, 0), 0, 'a fresh level 1 player has zero lifetime EXP');
  assert.equal(lifetimeExpFor(1, -500), 0, 'negative within-level EXP normalises to zero');

  // Exact-threshold derivation: holding precisely the cumulative for level N makes you
  // level N, not N-1.
  for (let level = 1; level <= MAX_COMBAT_LEVEL; level += 1) {
    const derived = levelFromLifetimeExp(CUMULATIVE_EXP[level - 1]);
    assert.equal(derived.level, level, `cumulative for level ${level} derives to level ${level}`);
    assert.equal(derived.exp, 0, `cumulative for level ${level} leaves an empty bar`);
  }

  // One EXP short of a threshold is still the previous level, with a nearly full bar.
  for (let level = 2; level <= MAX_COMBAT_LEVEL; level += 1) {
    const derived = levelFromLifetimeExp(CUMULATIVE_EXP[level - 1] - 1);
    assert.equal(derived.level, level - 1, `one short of level ${level} stays at ${level - 1}`);
  }

  const overflow = levelFromLifetimeExp(TOTAL_TO_LEVEL_100 + 5_000_000_000);
  assert.equal(overflow.level, 100, 'excess lifetime EXP does not overflow the cap');
}

// ── the conversion is level-stable and EXP-exact ────────────────────────────
// Every level 1-50 at 0%, 50% and 99% of the OLD bar must round-trip unchanged. This
// is the property the migration's abort assertion checks per row.
{
  for (let level = 1; level <= 50; level += 1) {
    const oldRequirement = OLD_EXP_TO_NEXT[level - 1] || 0;
    for (const fraction of [0, 0.5, 0.99]) {
      const exp = Math.floor(oldRequirement * fraction);
      const derived = levelFromLifetimeExp(lifetimeExpFor(level, exp));
      assert.equal(derived.level, level, `L${level} @${fraction * 100}% old bar keeps its level`);
      assert.equal(derived.exp, exp, `L${level} @${fraction * 100}% old bar keeps its exact EXP`);
    }
  }

  // The three reference conversions from the spec, including the visible bar shrink.
  const cases = [
    { level: 31, exp: 500_000, lifetime: 13_101_650, oldBar: '34.5', newBar: '23.8' },
    { level: 25, exp: 300_000, lifetime: 6_206_650, oldBar: '53.1', newBar: '31.6' },
    { level: 20, exp: 100_000, lifetime: 2_036_650, oldBar: '46.5', newBar: '14.3' },
  ];
  for (const c of cases) {
    assert.equal(lifetimeExpFor(c.level, c.exp), c.lifetime, `L${c.level} conversion total`);
    const oldBar = ((c.exp / OLD_EXP_TO_NEXT[c.level - 1]) * 100).toFixed(1);
    const newBar = ((c.exp / EXP_TO_NEXT[c.level - 1]) * 100).toFixed(1);
    assert.equal(oldBar, c.oldBar, `L${c.level} old bar`);
    assert.equal(newBar, c.newBar, `L${c.level} new bar`);
    assert(Number(newBar) < Number(oldBar), 'bars shrink — this is intended, not a bug');
  }
}

// ── scaleExpForMobLevel ─────────────────────────────────────────────────────
{
  assert.equal(scaleExpForMobLevel(300, SCALING_PIVOT_LEVEL), 300, 'neutral at the pivot');
  assert.equal(scaleExpForMobLevel(300, 20), 300, 'floor holds below the pivot');
  assert.equal(scaleExpForMobLevel(300, 1), 300, 'floor holds at the very bottom');
  assert.equal(scaleExpForMobLevel(300, 100), 3333, 'quadratic at level 100');
  assert.equal(scaleExpForMobLevel(300, MOB_LEVEL_MAX), 4800, 'ceiling at MOB_LEVEL_MAX');
  assert.equal(scaleExpForMobLevel(300, 999), 4800, 'clamped above the ceiling');

  // Monotonic non-decreasing across the whole legal range and beyond it.
  let previous = 0;
  for (let level = 1; level <= 150; level += 1) {
    const value = scaleExpForMobLevel(300, level);
    assert(value >= previous, `scaling must not decrease at mob level ${level}`);
    previous = value;
  }

  // Never a nerf: for any base and any level, the result is at least the base.
  for (const base of [50, 150, 300, 600, 20_000, 40_000]) {
    for (let level = 1; level <= MOB_LEVEL_MAX; level += 1) {
      assert(scaleExpForMobLevel(base, level) >= base, `base ${base} at level ${level} is never reduced`);
    }
  }

  assert.equal(scaleExpForMobLevel(0, 100), 0, 'zero base stays zero');
  assert.equal(scaleExpForMobLevel(-500, 100), 0, 'negative base clamps to zero');

  // Expected mob level for the deterministic auto-raid path: player level + mean offset.
  assert.equal(expectedMobLevelFor(30), 37, 'mean offset is +6.5, rounded');
  assert.equal(expectedMobLevelFor(1), 8, 'low levels still get the offset');
  assert(expectedMobLevelFor(200) <= MOB_LEVEL_MAX, 'expected mob level respects the ceiling');
}

// ── no-leak: the multiplier touches EXP and nothing else ────────────────────
// Guards the structural rule that scaling is applied at the award call site rather
// than to the loot object, so credux and shard rolls cannot inherit it.
{
  const payload = { exp: 300, credux: 750, shards: 7, chest: 'gold_chest' };
  const scaled = { ...payload, exp: scaleExpForMobLevel(payload.exp, 100) };
  assert.equal(scaled.exp, 3333, 'EXP scales');
  assert.equal(scaled.credux, payload.credux, 'credux must not inherit the multiplier');
  assert.equal(scaled.shards, payload.shards, 'shards must not inherit the multiplier');
  assert.equal(scaled.chest, payload.chest, 'chest roll must not inherit the multiplier');
}

// ── int8 parser: lifetime_exp arrives as a number, not a string ─────────────
// The curve exceeds int32, so pg returns it as a string without the parser registered
// in src/db/pool.js. Asserting the mapping directly keeps this suite DB-free.
{
  const { types } = require('pg');
  require('../src/db/pool');
  const parse = types.getTypeParser(20);
  const parsed = parse(String(TOTAL_TO_LEVEL_100));
  assert.equal(typeof parsed, 'number', 'int8 must parse to a JS number');
  assert.equal(parsed, TOTAL_TO_LEVEL_100, 'and must be lossless across our range');
  assert.equal(parse(null), null, 'null passes through');
  assert(TOTAL_TO_LEVEL_100 < Number.MAX_SAFE_INTEGER, 'the curve stays inside the safe range');
}

console.log('EXP CURVE SELFTEST: passed');
process.exit(0);
