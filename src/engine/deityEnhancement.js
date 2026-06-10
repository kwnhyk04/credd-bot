'use strict';

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
// Column totals: Epic 102 · Mythic 70 · Legendary 44 · Supreme 30.
const DEITY_ESSENCE_COST = {
  Epic:      { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9, 7: 12, 8: 15, 9: 20, 10: 25 },
  Mythic:    { 1: 2, 2: 3, 3: 3, 4: 4, 5: 5, 6: 6, 7: 8,  8: 10, 9: 13, 10: 16 },
  Legendary: { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 5,  8: 6,  9: 7,  10: 8 },
  Supreme:   { 1: 2, 2: 2, 3: 2, 4: 2, 5: 3, 6: 3, 7: 3,  8: 4,  9: 4,  10: 5 },
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

module.exports = {
  MAX_ENHANCEMENT,
  DEITY_BOOST_TABLE,
  DEITY_ESSENCE_COST,
  computeDeityStats,
  nextDeityAttempt,
};
