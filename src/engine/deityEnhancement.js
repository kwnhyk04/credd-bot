'use strict';

const { computeSigilStats } = require('../config/ascension');

/**
 * Deity enhancement constants + pure helper (Master §9, §35.6).
 *
 * Uniform boost: all three stats (HP/ATK/DEF) gain the SAME +10% per level —
 * linear, 1→×1.00 … 11→×2.00. curr = floor(base × DEITY_BOOST_TABLE[enhancement]).
 * `enhancement` is stored 1..11, displayed as stored-1 (+0..+10).
 */

const MAX_ENHANCEMENT = 11; // stored; display +10

// Stored enhancement (1..11) → stat multiplier (+10%/level).
const DEITY_BOOST_TABLE = {
  1: 1.00, 2: 1.10, 3: 1.20, 4: 1.30, 5: 1.40, 6: 1.50,
  7: 1.60, 8: 1.70, 9: 1.80, 10: 1.90, 11: 2.00,
};

// ── Essence cost (§9) — [deity's own tier][target display level (1..10)] ────
// Spent as the deity's own tier essence. Deterministic: 100% success whenever
// the essence requirement is met (no success-rate table exists for deities).
// Column totals: Epic 330 · Mythic 285 · Legendary 190 · Supreme 100.
const DEITY_ESSENCE_COST = {
  Epic:      { 1: 15, 2: 19, 3: 23, 4: 27, 5: 31, 6: 35, 7: 39, 8: 43, 9: 47, 10: 51 },
  Mythic:    { 1: 15, 2: 18, 3: 21, 4: 24, 5: 27, 6: 30, 7: 33, 8: 36, 9: 39, 10: 42 },
  Legendary: { 1: 10, 2: 12, 3: 14, 4: 16, 5: 18, 6: 20, 7: 22, 8: 24, 9: 26, 10: 28 },
  Supreme:   { 1: 4, 2: 5, 3: 6, 4: 7, 5: 8, 6: 10, 7: 12, 8: 14, 9: 16, 10: 18 },
};

/**
 * Recompute stored curr stats for a given stored enhancement (1..11).
 * @returns {{curr_atk:number, curr_hp:number, curr_def:number}}
 */
function computeDeityStats({ base_atk, base_hp, base_def }, enhancement) {
  const m = DEITY_BOOST_TABLE[enhancement];
  if (m == null) throw new Error(`computeDeityStats: invalid enhancement ${enhancement}`);
  return {
    curr_atk: Math.floor(base_atk * m),
    curr_hp: Math.floor(base_hp * m),
    curr_def: Math.floor(base_def * m),
  };
}

/**
 * Next-attempt parameters for a deity currently at stored `enhancement`.
 * Returns null when maxed (display +10). Deterministic — no success rate.
 * @returns {{targetLevel:number, cost:number} | null}
 */
function nextDeityAttempt(tier, enhancement) {
  if (enhancement >= MAX_ENHANCEMENT) return null;
  const costs = DEITY_ESSENCE_COST[tier];
  if (!costs) return null;
  return { targetLevel: enhancement, cost: costs[enhancement] };
}

function computeDeityProgressionStats(deity, { sigils, ascended, enhancement }) {
  if (!ascended) return computeSigilStats(deity, sigils);
  const storedEnhancement = Math.max(1, Math.min(MAX_ENHANCEMENT, Number(enhancement) || 1));
  return computeDeityStats(deity, storedEnhancement);
}

module.exports = {
  MAX_ENHANCEMENT,
  DEITY_BOOST_TABLE,
  DEITY_ESSENCE_COST,
  computeDeityStats,
  computeDeityProgressionStats,
  nextDeityAttempt,
};
