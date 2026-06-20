'use strict';

/**
 * combatExp.js — Combat Level EXP curve (Master §17, authoritative table).
 *
 * user_character.combat_exp is WITHIN-LEVEL progress ("EXP toward next combat
 * level" per the data dictionary), mirroring believer_exp. EXP_REQUIRED[L] is
 * the cost of going L → L+1. Max combat level 50 (schema CHECK 1..50); at the
 * cap, exp keeps accumulating within level 50 but never levels.
 *
 * [Jun-2026 patch §6] Anti auto-grind rescale: the early/mid curve was too shallow
 * for the fixed 100–500 EXP/raid rewards (a 4-hour auto-raider hit L22). This table
 * raises the floor most in early/mid game, tapers toward the original shape at the top,
 * keeps every per-level cost STRICTLY INCREASING, and fixes the old 40→41 < 39→40 dip.
 * Cumulative: L20 708,850 · L30 6,413,850 · L40 32,493,850 · L50 126,993,850.
 */

const MAX_COMBAT_LEVEL = 50;

const EXP_REQUIRED = {
  1: 100, 2: 250, 3: 500, 4: 900, 5: 1500,
  6: 2400, 7: 3700, 8: 5500, 9: 8000, 10: 12000,
  11: 17000, 12: 24000, 13: 33000, 14: 45000, 15: 60000,
  16: 80000, 17: 105000, 18: 135000, 19: 175000, 20: 215000,
  21: 265000, 22: 325000, 23: 395000, 24: 475000, 25: 565000,
  26: 670000, 27: 790000, 28: 925000, 29: 1080000, 30: 1250000,
  31: 1450000, 32: 1680000, 33: 1950000, 34: 2250000, 35: 2600000,
  36: 3000000, 37: 3450000, 38: 3950000, 39: 4500000, 40: 5100000,
  41: 5800000, 42: 6600000, 43: 7500000, 44: 8500000, 45: 9600000,
  46: 10800000, 47: 12100000, 48: 13500000, 49: 15000000,
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
