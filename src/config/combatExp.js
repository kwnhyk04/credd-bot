'use strict';

/**
 * combatExp.js — Combat Level EXP curve (Master §17, authoritative table).
 *
 * user_character.combat_exp is WITHIN-LEVEL progress ("EXP toward next combat
 * level" per the data dictionary), mirroring believer_exp. EXP_REQUIRED[L] is
 * the cost of going L → L+1. Max combat level 50 (schema CHECK 1..50); at the
 * cap, exp keeps accumulating within level 50 but never levels.
 *
 * NOTE: 40→41 (800k) is intentionally LOWER than 39→40 (1.43M) — authored
 * Tier-4 reset in §17, not a typo.
 */

const MAX_COMBAT_LEVEL = 50;

const EXP_REQUIRED = {
  1: 100, 2: 200, 3: 350, 4: 500, 5: 700,
  6: 1000, 7: 1400, 8: 1900, 9: 2500, 10: 4000,
  11: 6000, 12: 8500, 13: 11500, 14: 15000, 15: 19500,
  16: 25000, 17: 32000, 18: 40000, 19: 50000, 20: 60000,
  21: 75000, 22: 90000, 23: 110000, 24: 130000, 25: 155000,
  26: 180000, 27: 210000, 28: 245000, 29: 280000, 30: 350000,
  31: 430000, 32: 520000, 33: 620000, 34: 730000, 35: 850000,
  36: 980000, 37: 1120000, 38: 1270000, 39: 1430000, 40: 800000,
  41: 1000000, 42: 1200000, 43: 1500000, 44: 1800000, 45: 2200000,
  46: 2700000, 47: 3300000, 48: 4000000, 49: 5000000,
};

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

module.exports = { MAX_COMBAT_LEVEL, EXP_REQUIRED, applyCombatExp };
