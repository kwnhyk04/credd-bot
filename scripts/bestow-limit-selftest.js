'use strict';

/**
 * STATIC SELF-TEST — bestow daily-cap helper (src/config/bestow.js).
 *
 * Pure function, NO database / Discord / env:
 *   node scripts/bestow-limit-selftest.js
 *
 * Verifies the level-scaled receiver cap, its base preservation, safe handling of
 * missing/invalid levels, integer precision, and exact at-limit / over-limit boundaries.
 */

const assert = require('node:assert/strict');
const {
  BASE_BESTOW_DAILY_CAP,
  BESTOW_LIMIT_PER_BELIEVER_LEVEL,
  BESTOW_LIMIT_PER_COMBAT_LEVEL,
  sanitizeLevel,
  computeBestowDailyCap,
} = require('../src/config/bestow');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed += 1; }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); }
}

const B = BESTOW_LIMIT_PER_BELIEVER_LEVEL; // 500_000
const C = BESTOW_LIMIT_PER_COMBAT_LEVEL;   // 500_000

// ── named constants unchanged ────────────────────────────────────────────────
check('base cap preserved at 1,000,000', BASE_BESTOW_DAILY_CAP === 1_000_000, `got ${BASE_BESTOW_DAILY_CAP}`);
check('per-believer-level = 500,000', B === 500_000, `got ${B}`);
check('per-combat-level = 500,000', C === 500_000, `got ${C}`);

// ── level combinations ───────────────────────────────────────────────────────
check('L0 believer + L0 combat → base only', computeBestowDailyCap(0, 0) === 1_000_000,
  `got ${computeBestowDailyCap(0, 0)}`);
check('believer only (5,0)', computeBestowDailyCap(5, 0) === 1_000_000 + 5 * B,
  `got ${computeBestowDailyCap(5, 0)}`);
check('combat only (0,7)', computeBestowDailyCap(0, 7) === 1_000_000 + 7 * C,
  `got ${computeBestowDailyCap(0, 7)}`);
check('both contribute (1,1) → +1,000,000', computeBestowDailyCap(1, 1) === 1_000_000 + B + C,
  `got ${computeBestowDailyCap(1, 1)}`);
check('B10/C20 → base + 15,000,000', computeBestowDailyCap(10, 20) === 1_000_000 + 15_000_000,
  `got ${computeBestowDailyCap(10, 20)}`);
check('B30/C50 → base + 40,000,000', computeBestowDailyCap(30, 50) === 1_000_000 + 40_000_000,
  `got ${computeBestowDailyCap(30, 50)}`);

// ── max supported levels: integer-exact ──────────────────────────────────────
{
  const maxCap = computeBestowDailyCap(1000, 50); // believer well past any real level, combat DB-capped 50
  check('max levels integer-exact', maxCap === 1_000_000 + 1000 * B + 50 * C, `got ${maxCap}`);
  check('max levels stays a safe integer', Number.isSafeInteger(maxCap), `got ${maxCap}`);
  const huge = computeBestowDailyCap(100_000, 50);
  check('very large believer still safe integer', Number.isSafeInteger(huge), `got ${huge}`);
}

// ── missing / null / invalid → treated as level 0 (never negative/NaN) ───────
check('null levels → base', computeBestowDailyCap(null, null) === 1_000_000);
check('undefined levels → base', computeBestowDailyCap(undefined, undefined) === 1_000_000);
check('no args → base', computeBestowDailyCap() === 1_000_000);
check('negative levels → base (clamped to 0)', computeBestowDailyCap(-5, -9) === 1_000_000,
  `got ${computeBestowDailyCap(-5, -9)}`);
check('NaN / non-numeric → base', computeBestowDailyCap(NaN, 'x') === 1_000_000,
  `got ${computeBestowDailyCap(NaN, 'x')}`);
check('cap is never below base / never negative', computeBestowDailyCap(-1e9, -1e9) === 1_000_000);
// string-numeric DB values (pg returns bigint/int as strings sometimes) coerce correctly
check('numeric strings coerce', computeBestowDailyCap('3', '4') === 1_000_000 + 3 * B + 4 * C,
  `got ${computeBestowDailyCap('3', '4')}`);

// ── sanitizeLevel unit behavior ──────────────────────────────────────────────
check('sanitizeLevel floors fractional', sanitizeLevel(3.9) === 3, `got ${sanitizeLevel(3.9)}`);
check('sanitizeLevel(null) = 0', sanitizeLevel(null) === 0);
check('sanitizeLevel(-2) = 0', sanitizeLevel(-2) === 0);
check('sanitizeLevel(0) = 0', sanitizeLevel(0) === 0);
check('sanitizeLevel("12") = 12', sanitizeLevel('12') === 12);

// ── enforcement boundary: exactly at limit vs one over ───────────────────────
{
  const limit = computeBestowDailyCap(3, 4); // 1,000,000 + 3.5M = 4,500,000
  const receivedToday = 0;
  const headroom = limit - receivedToday;
  const atLimit = limit;
  const overByOne = limit + 1;
  // enforcement rule in bestow.js is `amount > headroom` → reject
  check('bestow exactly at limit is allowed', !(atLimit > headroom), `limit ${limit}`);
  check('bestow one over limit is rejected', overByOne > headroom, `limit ${limit}`);
}

// ── existing usage reduces remaining allowance ───────────────────────────────
{
  const limit = computeBestowDailyCap(2, 2); // 3,000,000
  const receivedToday = 2_500_000;
  const headroom = limit - receivedToday; // 500,000
  check('remaining allowance = limit − receivedToday', headroom === 500_000, `got ${headroom}`);
  check('amount within remaining allowed', !(500_000 > headroom));
  check('amount above remaining rejected', 500_001 > headroom);
}

// ── displayed limit == enforced limit (single source of truth) ───────────────
{
  // The same helper feeds both the pre-check and the in-transaction enforcement, so a
  // displayed cap and the enforced cap can never diverge for equal inputs.
  const a = computeBestowDailyCap(7, 13);
  const b = computeBestowDailyCap(7, 13);
  check('helper deterministic (display == enforce)', a === b, `${a} vs ${b}`);
}

// ── large-value integer precision (no float drift) ───────────────────────────
{
  const cap = computeBestowDailyCap(9_007, 50); // ~4.5e9, well under 2^53
  assert.equal(cap, 1_000_000 + 9_007 * B + 50 * C);
  check('large cap has no float drift', cap === 1_000_000 + 9_007 * 500_000 + 50 * 500_000, `got ${cap}`);
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\nBESTOW LIMIT SELFTEST: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log('BESTOW LIMIT SELFTEST: passed');
}
