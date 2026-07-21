'use strict';

/**
 * Bestow daily-cap configuration (Master §3).
 *
 * The cap is RECEIVER-side and resets on the PHT (Asia/Manila) day boundary — see
 * `src/commands/economy/bestow.js`. The base value is preserved; the cap now scales with
 * the receiver's Believer Level and Combat Level (authoritative `user_character` values).
 *
 * All arithmetic is integer. The realistic maximum (believer ≈ hundreds, combat ≤ 50 by DB
 * CHECK) stays far below Number.MAX_SAFE_INTEGER, so plain Number math is exact here.
 */

const BASE_BESTOW_DAILY_CAP = 1_000_000;          // receiver-side Credux/day, preserved base
const BESTOW_LIMIT_PER_BELIEVER_LEVEL = 500_000;  // added per Believer Level
const BESTOW_LIMIT_PER_COMBAT_LEVEL = 500_000;    // added per Character Combat Level

/** Coerce a level to a safe non-negative integer; missing/null/NaN/negative → 0. */
function sanitizeLevel(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Receiver daily bestow cap = base + believerLevel×500k + combatLevel×500k.
 * Invalid levels are treated as 0 (never negative, never NaN).
 */
function computeBestowDailyCap(believerLevel, combatLevel) {
  return BASE_BESTOW_DAILY_CAP
    + sanitizeLevel(believerLevel) * BESTOW_LIMIT_PER_BELIEVER_LEVEL
    + sanitizeLevel(combatLevel) * BESTOW_LIMIT_PER_COMBAT_LEVEL;
}

module.exports = {
  BASE_BESTOW_DAILY_CAP,
  BESTOW_LIMIT_PER_BELIEVER_LEVEL,
  BESTOW_LIMIT_PER_COMBAT_LEVEL,
  sanitizeLevel,
  computeBestowDailyCap,
};
