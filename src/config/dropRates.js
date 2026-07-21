'use strict';

const { chance, int, unit, weightedIndex } = require('../utils/secureRng');

/**
 * Chest drop rates (§5) + weapon stat banding (§7) + armor stat banding (v5 §C.1).
 * Hardcoded game-balance constants. No schema/seed.
 *
 * [v5 GEAR OVERHAUL] Weapons roll ATK + CRIT only (HP/DEF removed). Armor is a
 * new gear class rolling HP + DEF only (no CRIT). Existing chests drop weapon OR
 * armor via GEAR_SPLIT — there is NO dedicated armor chest.
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
  // [Genesis update] Diamond Chest — CRD Shop weekly premium gear chest.
  dmc: {
    column: 'diamond_chest', action: 'Diamond Chest',
    drops: [['Mythic', 0.50], ['Legendary', 0.50]],
  },
  // [Genesis update] Genesis Chest — always one of the five Genesis weapons
  // (weapon-only: the open flow skips the weapon/armor split for this tier).
  gnc: {
    column: 'genesis_chest', action: 'Genesis Chest',
    drops: [['Genesis', 1.00]],
    maxOpen: 1, // premium chest — opens one at a time (like Supreme)
  },
};

const CHEST_ALIASES = Object.keys(CHESTS); // ['sc','gc','btc','bgtc','supc']
const MAX_OPEN = 20;

// [v5] Per-drop gear-class roll: weapon vs armor. 0.5 = 50/50 (Blueprint 1.2).
// Single tunable constant (re-checked in the Phase 6 economy pass), NOT in the DB.
const GEAR_SPLIT = 0.5;

// [v5] Armor type weighting at drop (1/3 each — Blueprint 1.2).
const ARMOR_TYPES = ['Heavy', 'Medium', 'Light'];

// ── Weapon tier stat ranges (§7) ───────────────────────────────────────────
// [v5] ATK + CRIT only. HP/DEF removed from weapons.
const TIER_RANGES = {
  Rare:      { atk: [100, 150], crit: [1, 5] },
  Mythic:    { atk: [200, 350], crit: [1, 5] },
  Legendary: { atk: [500, 600], crit: [3, 7] },
  // Supreme handled separately (fixed 800 ATK, crit 0, 50% damage rider).
};

// ── Weapon type qualitative profile (§7 / v5 §B.3) ─────────────────────────
// [v5] Shield removed. CRIT re-banded by type (Bow crit-fisher … Staff near-zero).
const TYPE_PROFILES = {
  Sword:  { atk: 'Balanced', crit: 'Balanced' },
  Staff:  { atk: 'Highest',  crit: 'Lowest' },
  Gloves: { atk: 'High',     crit: 'Low' },
  Bow:    { atk: 'High',     crit: 'High' },
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

// Supreme fixed weapon stats (§7/§8/§35.2). DEF/HP gone; single 50% damage rider.
const SUPREME_STATS = {
  atk: 800, crit: 10.0, // [v5 tweak] Supreme weapons fixed 10% crit on drop.
  bonus_dmg_pct: 50.00,
};

// [Genesis update] Genesis fixed weapon stats (specs/genesis_tier_weapons.md):
// ATK 1600 · Crit Rate 20%. The spec's "+50% Crit Damage" is carried by the
// same damage-rider stat the Supreme tier uses (bonus_dmg_pct) — the engine
// has no separate crit-damage stat.
const GENESIS_STATS = {
  atk: 1600, crit: 20.0,
  bonus_dmg_pct: 50.00,
};

// Legendary bonus rider: 25% chance → +25% damage % (single unified stat).
const LEGENDARY_BONUS_CHANCE = 0.25;
const LEGENDARY_BONUS_VALUE = 25.00;

// ── Armor stat banding (v5 §C.1) ───────────────────────────────────────────
// HP + DEF only, positioned within the tier range by type.
const ARMOR_TIER_RANGES = {
  Rare:      { hp: [100, 200], def: [50, 75] },
  Mythic:    { hp: [300, 400], def: [80, 150] },
  Legendary: { hp: [600, 800], def: [200, 300] },
  // Supreme is fixed by type (no roll) — see SUPREME_ARMOR.
};

// Heavy: HP bottom 40% / DEF top 20% · Medium: both mid 40–60% · Light: HP top 20% / DEF bottom 40%.
const ARMOR_TYPE_PROFILES = {
  Heavy:  { hp: 'Low',      def: 'Highest' },
  Medium: { hp: 'Balanced', def: 'Balanced' },
  Light:  { hp: 'Highest',  def: 'Low' },
};

// Supreme armor — fixed by type (v5 §C.1).
const SUPREME_ARMOR = {
  Heavy:  { hp: 1000, def: 600 },
  Medium: { hp: 1200, def: 500 },
  Light:  { hp: 1400, def: 400 },
};

/**
 * Roll a chest's drop tier via cumulative walk. Returns a tier string.
 */
function rollTier(chestAlias) {
  const chest = CHESTS[chestAlias];
  return chest.drops[weightedIndex(chest.drops.map(([, weight]) => weight))][0];
}

/** Roll the gear class for one drop: 'weapon' or 'armor' (GEAR_SPLIT). */
function rollGearClass() {
  return chance(GEAR_SPLIT) ? 'weapon' : 'armor';
}

/** Roll an armor type, 1/3 each (Heavy/Medium/Light). */
function rollArmorType() {
  return ARMOR_TYPES[int(ARMOR_TYPES.length)];
}

// ── Native socket count rolled at gear drop (Phase 2 §2.2) ──────────────────
// Native lane = weapon:offense / armor:defense. Opposite slots are NOT rolled —
// they're bought via `crd unlock socket`. Common gear has zero sockets.
// [tier] → [[count, probability], …]  (probabilities sum to 1.0)
const NATIVE_SOCKET_ROLL = {
  Common:    [[0, 1.00]],
  Rare:      [[1, 0.70], [2, 0.30]],
  Mythic:    [[1, 0.40], [2, 0.60]],
  Legendary: [[2, 1.00]],
  Supreme:   [[2, 1.00]],
  Genesis:   [[2, 1.00]],
};

/** Roll how many native sockets a freshly-dropped gear piece has, by tier. */
function rollNativeSocketCount(tier) {
  const table = NATIVE_SOCKET_ROLL[tier] || NATIVE_SOCKET_ROLL.Common;
  return table[weightedIndex(table.map(([, weight]) => weight))][0];
}

/**
 * Build the JSONB socket array for a slot count: [{slot:1,rune_uid:null}, …].
 * Shape per Naming Conventions §5. count 0 → [].
 */
function buildSocketArray(count) {
  const capped = Math.max(0, Math.min(Number(count) || 0, 2));
  return Array.from({ length: capped }, (_, i) => ({ slot: i + 1, rune_uid: null }));
}

function bandedValue(range, band) {
  const [min, max] = range;
  const [lo, hi] = BAND_FRACTIONS[band];
  const frac = lo + unit() * (hi - lo);
  return min + frac * (max - min);
}

/**
 * Roll weapon stats for a tier + weapon type (v5: ATK + CRIT only).
 * Returns { atk, crit, bonus_dmg_pct|null }.
 * curr_atk equals base_atk at drop (enhancement 1).
 */
function rollWeaponStats(tier, type) {
  if (tier === 'Supreme') {
    return { ...SUPREME_STATS };
  }
  if (tier === 'Genesis') {
    return { ...GENESIS_STATS }; // fixed — no roll, no type banding
  }

  const range = TIER_RANGES[tier];
  const profile = TYPE_PROFILES[type];
  if (!range || !profile) {
    throw new Error(`rollWeaponStats: unknown tier/type ${tier}/${type}`);
  }

  const atk = Math.floor(bandedValue(range.atk, profile.atk));
  const crit = Math.round(bandedValue(range.crit, profile.crit) * 10) / 10; // 1 decimal

  let bonus_dmg_pct = null;
  if (tier === 'Legendary' && chance(LEGENDARY_BONUS_CHANCE)) {
    bonus_dmg_pct = LEGENDARY_BONUS_VALUE;
  }

  return { atk, crit, bonus_dmg_pct };
}

/**
 * Roll armor stats for a tier + armor type (v5 §C.1: HP + DEF only).
 * Supreme is fixed by type. Returns { hp, def }. curr_* equal base_* at drop.
 */
function rollArmorStats(tier, type) {
  if (tier === 'Supreme') {
    const fixed = SUPREME_ARMOR[type];
    if (!fixed) throw new Error(`rollArmorStats: unknown Supreme type ${type}`);
    return { ...fixed };
  }

  const range = ARMOR_TIER_RANGES[tier];
  const profile = ARMOR_TYPE_PROFILES[type];
  if (!range || !profile) {
    throw new Error(`rollArmorStats: unknown tier/type ${tier}/${type}`);
  }

  const hp = Math.floor(bandedValue(range.hp, profile.hp));
  const def = Math.floor(bandedValue(range.def, profile.def));
  return { hp, def };
}

module.exports = {
  CHESTS,
  CHEST_ALIASES,
  MAX_OPEN,
  GEAR_SPLIT,
  ARMOR_TYPES,
  TIER_RANGES,
  TYPE_PROFILES,
  BAND_FRACTIONS,
  SUPREME_STATS,
  GENESIS_STATS,
  ARMOR_TIER_RANGES,
  ARMOR_TYPE_PROFILES,
  SUPREME_ARMOR,
  NATIVE_SOCKET_ROLL,
  rollTier,
  rollGearClass,
  rollArmorType,
  rollNativeSocketCount,
  buildSocketArray,
  rollWeaponStats,
  rollArmorStats,
};
