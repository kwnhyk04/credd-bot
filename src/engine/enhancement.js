'use strict';

/**
 * Weapon enhancement constants + pure helpers (Master §7, §35.6).
 *
 * Source of truth:
 *   - Boost table (§35.6 / Blueprint §2.2): curr = floor(base × BOOST[enhancement]).
 *     The old linear `base × (1 + (e-1)×0.05)` is REMOVED.
 *   - Genesis +11..+20: each level adds 10% of the weapon's +10 ATK.
 *     This is additive from the +10 baseline, not 10% of the +0/base ATK.
 *   - Credux cost + success rate (§7): keyed by the TARGET display level.
 *     Genesis can reach +20; +11 through +20 reuse Supreme +10 cost/chance.
 *
 * Stored↔display: `enhancement` is one-based, so display level is stored-1.
 * Standard gear caps at stored 11 (+10); Genesis caps at stored 21 (+20).
 * Common has NO cost column in §7 → Common weapons are not enhanceable.
 */

const MAX_ENHANCEMENT = 11; // stored; display +10
const GENESIS_MAX_ENHANCEMENT = 21; // stored; display +20
const GENESIS_POST_10_STEP = 0.10; // each level adds 10% of the +10 ATK
const ENHANCEABLE_TIERS = ['Rare', 'Mythic', 'Legendary', 'Supreme', 'Genesis'];

// ── Boost table (§35.6) — stored enhancement (1..11) → stat multiplier ──────
const WEAPON_BOOST_TABLE = {
  1: 1.0,
  2: 1.05,
  3: 1.1,
  4: 1.15,
  5: 1.2,
  6: 1.25,
  7: 1.32,
  8: 1.4,
  9: 1.5,
  10: 1.7,
  11: 2.0,
};

// ── Success rates (§7) — target display level (1..10) → probability ─────────
// Genesis +11 through +20 reuse the +10 rate.
const SUCCESS_RATE = {
  1: 1.0,
  2: 0.95,
  3: 0.85,
  4: 0.75,
  5: 0.65,
  6: 0.55,
  7: 0.4,
  8: 0.3,
  9: 0.2,
  10: 0.1,
};

// ── Credux cost (§7) — [tier][target display level] → Credux ───────────
const ENHANCE_COST = {
  Rare: {
    1: 1000,
    2: 3000,
    3: 6000,
    4: 12000,
    5: 20000,
    6: 35000,
    7: 55000,
    8: 90000,
    9: 100000,
    10: 100000,
  },
  Mythic: {
    1: 5000,
    2: 12000,
    3: 25000,
    4: 50000,
    5: 90000,
    6: 150000,
    7: 250000,
    8: 400000,
    9: 650000,
    10: 1000000,
  },
  Legendary: {
    1: 15000,
    2: 35000,
    3: 70000,
    4: 130000,
    5: 220000,
    6: 380000,
    7: 600000,
    8: 900000,
    9: 1500000,
    10: 2000000,
  },
  Supreme: {
    1: 50000,
    2: 100000,
    3: 200000,
    4: 400000,
    5: 650000,
    6: 1000000,
    7: 1500000,
    8: 3000000,
    9: 3000000,
    10: 3000000,
  },
  Genesis: {
    1: 50000,
    2: 100000,
    3: 200000,
    4: 400000,
    5: 650000,
    6: 1000000,
    7: 1500000,
    8: 3000000,
    9: 3000000,
    10: 3000000,
    11: 3000000,
    12: 3000000,
    13: 3000000,
    14: 3000000,
    15: 3000000,
    16: 3000000,
    17: 3000000,
    18: 3000000,
    19: 3000000,
    20: 3000000,
  },
};

/**
 * Recompute a weapon's stored curr stat for a valid tier-specific enhancement.
 * [v5] Weapons are ATK-only now (HP/DEF removed). crit / bonus_* are unaffected.
 * @returns {{curr_atk:number}}
 */
function maxStoredEnhancement(tier, kind = 'weapon') {
  return kind === 'weapon' && tier === 'Genesis'
    ? GENESIS_MAX_ENHANCEMENT
    : MAX_ENHANCEMENT;
}

function maxDisplayEnhancement(tier, kind = 'weapon') {
  return maxStoredEnhancement(tier, kind) - 1;
}

function computeWeaponStats({ base_atk, tier }, enhancement) {
  const stored = Math.floor(Number(enhancement));
  const maxStored = maxStoredEnhancement(tier);
  if (!Number.isInteger(stored) || stored < 1 || stored > maxStored)
    throw new Error(`computeWeaponStats: invalid enhancement ${enhancement}`);
  if (tier === 'Genesis' && stored > MAX_ENHANCEMENT) {
    const plusTenAtk = Math.floor(base_atk * WEAPON_BOOST_TABLE[MAX_ENHANCEMENT]);
    const perLevelAtk = Math.floor(plusTenAtk * GENESIS_POST_10_STEP);
    return {
      curr_atk: plusTenAtk + perLevelAtk * (stored - MAX_ENHANCEMENT),
    };
  }
  const m = WEAPON_BOOST_TABLE[stored];
  if (m == null)
    throw new Error(`computeWeaponStats: invalid enhancement ${enhancement}`);
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
  if (m == null)
    throw new Error(`computeArmorStats: invalid enhancement ${enhancement}`);
  return {
    curr_hp: Math.floor(base_hp * m),
    curr_def: Math.floor(base_def * m),
  };
}

/**
 * Resolve the next-attempt parameters for a weapon currently at stored `enhancement`.
 * Returns null if the tier-specific maximum is reached.
 * @returns {{targetLevel:number, cost:number, successRate:number} | null}
 */
function nextAttempt(tier, enhancement, kind = 'weapon') {
  const tierCosts = ENHANCE_COST[tier];
  if (!tierCosts) return null; // non-enhanceable tier (e.g. Common)
  const stored = Math.floor(Number(enhancement) || 1);
  if (stored >= maxStoredEnhancement(tier, kind)) return null;
  const targetLevel = stored; // stored e → attempting display +e
  const cost = tierCosts[targetLevel];
  const successRate = SUCCESS_RATE[Math.min(targetLevel, 10)];
  if (!Number.isFinite(cost) || !Number.isFinite(successRate)) return null;
  return {
    targetLevel,
    cost,
    successRate,
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
  const stored = Math.max(
    1,
    Math.min(maxStoredEnhancement(tier), Math.floor(Number(enhancement) || 1)),
  );
  const completedLevel = stored - 1;
  let total = 0;
  for (let level = 1; level <= completedLevel; level += 1) {
    total += Number(tierCosts[level]) || 0;
  }
  return total;
}

module.exports = {
  MAX_ENHANCEMENT,
  GENESIS_MAX_ENHANCEMENT,
  GENESIS_POST_10_STEP,
  ENHANCEABLE_TIERS,
  WEAPON_BOOST_TABLE,
  SUCCESS_RATE,
  ENHANCE_COST,
  maxStoredEnhancement,
  maxDisplayEnhancement,
  computeWeaponStats,
  computeArmorStats,
  nextAttempt,
  successfulEnhancementCost,
};
