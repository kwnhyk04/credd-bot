'use strict';

/**
 * Chest drop rates (§5) + weapon stat banding (§7 ranges, §35.6 sub-bands).
 * Hardcoded game-balance constants. No schema/seed.
 */

// ── Chests ─────────────────────────────────────────────────────────────────
// alias → { column, action, drops: [[tier, probability], …] (must sum to 1.0),
//           maxOpen? (per-chest cap, defaults to MAX_OPEN) }
const CHESTS = {
  sc: {
    column: 'silver_chest', action: 'Silver Chest',
    drops: [['Rare', 0.85], ['Mythic', 0.15]],
  },
  gc: {
    column: 'gold_chest', action: 'Gold Chest',
    drops: [['Rare', 0.65], ['Mythic', 0.30], ['Legendary', 0.05]],
  },
  btc: {
    column: 'boss_treasure_chest', action: 'Boss Treasure Chest',
    drops: [['Rare', 0.50], ['Mythic', 0.40], ['Legendary', 0.10]],
  },
  bgtc: {
    column: 'boss_golden_chest', action: 'Boss Golden Chest',
    drops: [['Mythic', 0.45], ['Legendary', 0.45], ['Supreme', 0.10]],
  },
  supc: {
    column: 'supreme_chest', action: 'Supreme Chest',
    drops: [['Legendary', 0.70], ['Supreme', 0.30]],
    maxOpen: 1, // Supreme Chests open one at a time
  },
};

const CHEST_ALIASES = Object.keys(CHESTS); // ['sc','gc','btc','bgtc','supc']
const MAX_OPEN = 10;

// ── Tier stat ranges (§7) ────────────────────────────────────────────────
// [min, max] inclusive-ish (max reachable only at fraction 1.0 which rand never hits).
// [v4.4] ranges raised (new drops only — existing user_weapons rows are NOT rewritten).
const TIER_RANGES = {
  Rare:      { atk: [100, 150], hp: [100, 200], def: [50, 75],   crit: [1, 5] },
  Mythic:    { atk: [200, 350], hp: [300, 400], def: [80, 150],  crit: [1, 5] },
  Legendary: { atk: [500, 600], hp: [600, 800], def: [200, 300], crit: [1, 5] },
  // Supreme handled separately (fixed 800/1200/500, crit 0, 50/50 riders — unchanged).
};

// ── Type qualitative profile (§7) ─────────────────────────────────────────
const TYPE_PROFILES = {
  Sword:  { atk: 'Balanced', hp: 'Balanced', def: 'Balanced', crit: 'Low' },
  Staff:  { atk: 'Highest',  hp: 'Low',      def: 'Lowest',   crit: 'Low' },
  Gloves: { atk: 'High',     hp: 'High',     def: 'Low',      crit: 'Low' },
  Shield: { atk: 'Low',      hp: 'High',     def: 'Highest',  crit: 'Low' },
  Bow:    { atk: 'High',     hp: 'Low',      def: 'Low',      crit: 'High' },
};

// ── Banding sub-ranges (§35.6) ────────────────────────────────────────────
// fraction window [lo, hi] of the tier range.
const BAND_FRACTIONS = {
  Lowest:   [0.00, 0.20],
  Low:      [0.00, 0.40],
  Balanced: [0.40, 0.60],
  High:     [0.60, 1.00],
  Highest:  [0.80, 1.00],
};

// Supreme fixed stats (§7/§8/§35.2). [v4.4] DEF 400 → 500; crit-damage rider removed —
// the unified model uses a single damage % (50%), so bonus_crit_dmg_pct is left null.
const SUPREME_STATS = {
  atk: 800, hp: 1200, def: 500, crit: 0.0,
  bonus_dmg_pct: 50.00, bonus_crit_dmg_pct: null,
};

// Legendary bonus rider: 25% chance → +25% damage % (single unified stat — no separate
// crit-damage rider as of [v4.4]).
const LEGENDARY_BONUS_CHANCE = 0.25;
const LEGENDARY_BONUS_VALUE = 25.00;

/**
 * Roll a chest's drop tier via cumulative walk. Returns a tier string.
 */
function rollTier(chestAlias) {
  const chest = CHESTS[chestAlias];
  const r = Math.random();
  let acc = 0;
  for (const [tier, p] of chest.drops) {
    acc += p;
    if (r < acc) return tier;
  }
  return chest.drops[chest.drops.length - 1][0]; // FP safety net
}

function bandedValue(range, band) {
  const [min, max] = range;
  const [lo, hi] = BAND_FRACTIONS[band];
  const frac = lo + Math.random() * (hi - lo);
  return min + frac * (max - min);
}

/**
 * Roll weapon stats for a tier + weapon type.
 * Returns { atk, hp, def, crit, bonus_dmg_pct|null, bonus_crit_dmg_pct|null }.
 * curr_* equal base_* at drop (enhancement 1).
 */
function rollWeaponStats(tier, type) {
  if (tier === 'Supreme') {
    return { ...SUPREME_STATS };
  }

  const range = TIER_RANGES[tier];
  const profile = TYPE_PROFILES[type];
  if (!range || !profile) {
    throw new Error(`rollWeaponStats: unknown tier/type ${tier}/${type}`);
  }

  const atk = Math.floor(bandedValue(range.atk, profile.atk));
  const hp  = Math.floor(bandedValue(range.hp,  profile.hp));
  const def = Math.floor(bandedValue(range.def, profile.def));
  const crit = Math.round(bandedValue(range.crit, profile.crit) * 10) / 10; // 1 decimal

  // [v4.4] single unified damage % — no separate crit-damage rider (left null).
  let bonus_dmg_pct = null;
  const bonus_crit_dmg_pct = null;
  if (tier === 'Legendary' && Math.random() < LEGENDARY_BONUS_CHANCE) {
    bonus_dmg_pct = LEGENDARY_BONUS_VALUE;
  }

  return { atk, hp, def, crit, bonus_dmg_pct, bonus_crit_dmg_pct };
}

module.exports = {
  CHESTS,
  CHEST_ALIASES,
  MAX_OPEN,
  TIER_RANGES,
  TYPE_PROFILES,
  BAND_FRACTIONS,
  SUPREME_STATS,
  rollTier,
  rollWeaponStats,
};
