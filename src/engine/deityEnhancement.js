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

module.exports = { MAX_ENHANCEMENT, DEITY_BOOST_TABLE, computeDeityStats };
