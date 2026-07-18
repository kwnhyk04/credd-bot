'use strict';

/**
 * Weapon enhancement constants + pure helpers (Master §7, §35.6).
 *
 * Source of truth:
 *   - Boost table (§35.6 / Blueprint §2.2): curr = floor(base × BOOST[enhancement]).
 *     The old linear `base × (1 + (e-1)×0.05)` is REMOVED.
 *   - Credux cost + success rate (§7): keyed by the TARGET display level (+1..+10),
 *     same success rates across all tiers; Credux cost varies by tier.
 *
 * Stored↔display: `enhancement` is stored 1..11, displayed as stored-1 (+0..+10).
 * Attempting from display (e-1) → e uses table row `+e`. Stored 11 (display +10) = MAX.
 * Common has NO cost column in §7 → Common weapons are not enhanceable.
 */

const MAX_ENHANCEMENT = 11; // stored; display +10
const ENHANCEABLE_TIERS = ['Rare', 'Mythic', 'Legendary', 'Supreme'];

// ── Boost table (§35.6) — stored enhancement (1..11) → stat multiplier ──────
const WEAPON_BOOST_TABLE = {
  1: 1.00, 2: 1.05, 3: 1.10, 4: 1.15, 5: 1.20, 6: 1.25,
  7: 1.32, 8: 1.40, 9: 1.50, 10: 1.70, 11: 2.00,
};

// ── Success rates (§7) — target display level (1..10) → probability ─────────
// Same across all tiers.
const SUCCESS_RATE = {
  1: 1.00, 2: 0.95, 3: 0.85, 4: 0.75, 5: 0.65,
  6: 0.55, 7: 0.40, 8: 0.30, 9: 0.20, 10: 0.10,
};

// ── Credux cost (§7) — [tier][target display level (1..10)] → Credux ────────
const ENHANCE_COST = {
  Rare: {
    1: 1000, 2: 3000, 3: 6000, 4: 12000, 5: 20000,
    6: 35000, 7: 55000, 8: 90000, 9: 100000, 10: 100000,
  },
  Mythic: {
    1: 5000, 2: 12000, 3: 25000, 4: 50000, 5: 90000,
    6: 150000, 7: 250000, 8: 400000, 9: 650000, 10: 1000000,
  },
  Legendary: {
    1: 15000, 2: 35000, 3: 70000, 4: 130000, 5: 220000,
    6: 380000, 7: 600000, 8: 900000, 9: 1500000, 10: 2000000,
  },
  Supreme: {
    1: 50000, 2: 100000, 3: 200000, 4: 400000, 5: 650000,
    6: 1000000, 7: 1500000, 8: 3000000, 9: 3000000, 10: 3000000,
  },
};

/**
 * Recompute a weapon's stored curr stat for a given stored enhancement (1..11).
 * [v5] Weapons are ATK-only now (HP/DEF removed). crit / bonus_* are unaffected.
 * @returns {{curr_atk:number}}
 */
function computeWeaponStats({ base_atk }, enhancement) {
  const m = WEAPON_BOOST_TABLE[enhancement];
  if (m == null) throw new Error(`computeWeaponStats: invalid enhancement ${enhancement}`);
  return {
    curr_atk: Math.floor(base_atk * m),
  };
}

/**
 * Recompute an armor's stored curr stats for a given stored enhancement (1..11).
 * [v5] Armor is HP/DEF only — reuses the SAME WEAPON_BOOST_TABLE (§C.1 note).
 * @returns {{curr_hp:number, curr_def:number}}
 */
function computeArmorStats({ base_hp, base_def }, enhancement) {
  const m = WEAPON_BOOST_TABLE[enhancement];
  if (m == null) throw new Error(`computeArmorStats: invalid enhancement ${enhancement}`);
  return {
    curr_hp: Math.floor(base_hp * m),
    curr_def: Math.floor(base_def * m),
  };
}

/**
 * Resolve the next-attempt parameters for a weapon currently at stored `enhancement`.
 * Returns null if the weapon is maxed (display +10) — caller rejects.
 * @returns {{targetLevel:number, cost:number, successRate:number} | null}
 */
function nextAttempt(tier, enhancement) {
  if (enhancement >= MAX_ENHANCEMENT) return null; // already +10
  const targetLevel = enhancement; // stored e → attempting display +e
  const tierCosts = ENHANCE_COST[tier];
  if (!tierCosts) return null; // non-enhanceable tier (e.g. Common)
  return {
    targetLevel,
    cost: tierCosts[targetLevel],
    successRate: SUCCESS_RATE[targetLevel],
  };
}

/**
 * Sum the canonical costs of the enhancement levels the gear has successfully
 * reached. This deliberately counts each completed level once and does not try
 * to reconstruct failed attempts or the owner's historical spend.
 *
 * `enhancement` is the stored one-based value, so stored 8/display +7 sums the
 * tier's +1 through +7 rows.
 */
function successfulEnhancementCost(tier, enhancement) {
  const tierCosts = ENHANCE_COST[tier];
  if (!tierCosts) return 0;
  const stored = Math.max(1, Math.min(MAX_ENHANCEMENT, Math.floor(Number(enhancement) || 1)));
  const completedLevel = stored - 1;
  let total = 0;
  for (let level = 1; level <= completedLevel; level += 1) {
    total += Number(tierCosts[level]) || 0;
  }
  return total;
}

module.exports = {
  MAX_ENHANCEMENT,
  ENHANCEABLE_TIERS,
  WEAPON_BOOST_TABLE,
  SUCCESS_RATE,
  ENHANCE_COST,
  computeWeaponStats,
  computeArmorStats,
  nextAttempt,
  successfulEnhancementCost,
};
