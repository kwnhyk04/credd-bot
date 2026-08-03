'use strict';

const { chance, int } = require('../utils/secureRng');

/**
 * Greater Boss tier — Master §16 [v4.4].
 *
 * Apex boss variants. This module is the SINGLE source of truth for both the spawn
 * weighting AND the reward payout, so the spawn announcement and the defeat
 * distribution can never disagree about a boss's greater-ness or its rewards.
 *
 * Tier membership is matched by exact mob_roster name. If a configured name is not
 * seeded, it simply never matches a row and is skipped by the spawn pool.
 */

// Max boss attacks a player may make per day (PHT clock). The limit resets at
// midnight PHT and applies across all active boss spawns.
const MAX_BOSS_ATTACKS_PER_DAY = 2;

// Exact mob_roster.name values. "Jotun" is the seeded spelling of Jotunn.
const GREATER_BOSSES = new Set(['Jotun', 'Fafnir', 'Cerberus']);
const CALAMITY_BOSSES = new Set(['Fenrir', 'Bakunawa']);

const CALAMITY_SPAWN_CHANCE = 0.05;
const GREATER_SPAWN_CHANCE = 0.25;
const NORMAL_SPAWN_CHANCE = 1 - CALAMITY_SPAWN_CHANCE - GREATER_SPAWN_CHANCE;
const GREATER_CHEST_GOLDEN_CHANCE = 0.25;
const GREATER_TREASURE_HP_MULTIPLIER = 1.5;
const GREATER_GOLDEN_HP_MULTIPLIER = 2;

if (Math.abs(CALAMITY_SPAWN_CHANCE + GREATER_SPAWN_CHANCE + NORMAL_SPAWN_CHANCE - 1) > Number.EPSILON) {
  throw new Error('Boss spawn probabilities must sum to 1');
}

// Participation rewards are fixed per spawn variant and paid to every attacker.
const NORMAL_REWARD = Object.freeze({ credux: 100_000, exp: 20_000, shards: 1_000 });
const GREATER_TWIN_REWARD = Object.freeze({
  credux: 150_000,
  exp: 30_000,
  shards: 1_500,
});
const GREATER_GOLDEN_REWARD = Object.freeze({
  credux: 200_000,
  exp: 40_000,
  shards: 2_000,
});
const CALAMITY_REWARD = Object.freeze(Object.fromEntries(
  Object.entries(GREATER_GOLDEN_REWARD).map(([key, value]) => [key, value * 2])
));
const CALAMITY_NATURAL_CHEST = Object.freeze({
  column: 'boss_golden_chest', qty: 3, label: 'Boss Golden Chest',
});
const CALAMITY_DEV_CHEST = Object.freeze({
  column: 'supreme_chest', qty: 1, label: 'Supreme Chest',
});

const GREATER_VARIANTS = Object.freeze({
  twin: Object.freeze({
    key: 'twin',
    label: 'Twin Chest',
    hpMultiplier: GREATER_TREASURE_HP_MULTIPLIER,
    chest: Object.freeze({
      column: 'boss_treasure_chest',
      qty: 2,
      label: 'Boss Treasure Chest',
    }),
    reward: GREATER_TWIN_REWARD,
  }),
  golden: Object.freeze({
    key: 'golden',
    label: 'Boss Golden Chest',
    hpMultiplier: GREATER_GOLDEN_HP_MULTIPLIER,
    chest: Object.freeze({
      column: 'boss_golden_chest',
      qty: 1,
      label: 'Boss Golden Chest',
    }),
    reward: GREATER_GOLDEN_REWARD,
  }),
});

/**
 * Daily boss-attack cap predicate. Pure (no DB), so it is unit-testable in the
 * sandbox selftest.
 *   usedToday    = SUM(attacks) across today's rows (PHT)
 */
function bossAttackDecision({ usedToday, limit }) {
  if (Number(usedToday) >= limit) return { allowed: false, reason: 'daily' };
  return { allowed: true, reason: null };
}

function isGreaterBoss(name) {
  return GREATER_BOSSES.has(name);
}

function isCalamityBoss(name) {
  return CALAMITY_BOSSES.has(name);
}

function bossTier(name) {
  if (isCalamityBoss(name)) return 'calamity';
  if (isGreaterBoss(name)) return 'greater';
  return 'normal';
}

function greaterVariantForChest(chest) {
  if (chest?.column === 'boss_golden_chest' && Number(chest.qty) === 1) {
    return GREATER_VARIANTS.golden;
  }
  if (chest?.column === 'boss_treasure_chest' && Number(chest.qty) === 2) {
    return GREATER_VARIANTS.twin;
  }
  return null;
}

/** Reward bundle (credux/exp/shards) for a boss and its fixed spawn chest. */
function bossRewards(name, chest = null) {
  if (isCalamityBoss(name)) return CALAMITY_REWARD;
  if (!isGreaterBoss(name)) return NORMAL_REWARD;
  return greaterVariantForChest(chest)?.reward || GREATER_TWIN_REWARD;
}

/**
 * Roll the chest reward for a defeated boss. Column is from a fixed whitelist
 * (boss_treasure_chest / boss_golden_chest) — safe to interpolate into SQL.
 * Normal boss: 1 Boss Treasure Chest. Greater: 75% double Treasure / 25% Golden.
 * For a Greater Boss the roll is made ONCE per defeat (every attacker gets the same
 * outcome), matching the uniform participation model.
 */
function rollBossChest(name, rng = null) {
  if (isCalamityBoss(name)) return { ...CALAMITY_NATURAL_CHEST };
  if (!isGreaterBoss(name)) {
    return { column: 'boss_treasure_chest', qty: 1, label: 'Boss Treasure Chest' };
  }
  const isGolden = typeof rng === 'function'
    ? rng() < GREATER_CHEST_GOLDEN_CHANCE
    : chance(GREATER_CHEST_GOLDEN_CHANCE);
  const variant = isGolden ? GREATER_VARIANTS.golden : GREATER_VARIANTS.twin;
  return { ...variant.chest };
}

/**
 * Greater-boss HP adjustment tied to the chest fixed for that spawn.
 * Normal and calamity spawns deliberately remain 1×.
 */
function hpMultiplierForChest(chest) {
  return greaterVariantForChest(chest)?.hpMultiplier || 1;
}

/**
 * Apply the fixed Greater multiplier to base HP. Legacy arguments are accepted for callers.
 */
function bossMaxHpForChest(baseHp, hpPerLevel, level, chest = null) {
  const base = Number(baseHp);
  if (!Number.isFinite(base)) return 1;
  return Math.max(1, Math.floor(base * hpMultiplierForChest(chest)));
}

/**
 * Recover a Greater spawn's fixed chest after a process restart from persisted
 * max HP. Legacy formulas remain readable until every pre-change spawn is gone.
 */
function inferChestFromGreaterHp(baseHp, maxHp) {
  const base = Math.floor(Number(baseHp));
  const persisted = Math.floor(Number(maxHp));
  if (
    !Number.isFinite(base) || base <= 0
    || !Number.isFinite(persisted)
  ) {
    return null;
  }

  const variants = [GREATER_VARIANTS.golden, GREATER_VARIANTS.twin];
  for (const variant of variants) {
    if (persisted === Math.floor(base * variant.hpMultiplier)) {
      return { ...variant.chest };
    }
  }

  return null;
}

function bossChestForSpawn(name, spawnSource = 'natural', rng = null) {
  if (!isCalamityBoss(name)) return rollBossChest(name, rng);
  return spawnSource === 'dev' ? { ...CALAMITY_DEV_CHEST } : { ...CALAMITY_NATURAL_CHEST };
}

/**
 * Pick a boss row with the weighted tier roll: 5% Calamity / 25% Greater / 70% normal, then
 * uniform within the chosen pool. Falls back to the other pool if one is empty so
 * a missing Greater seed (or an all-Greater roster) never crashes. Returns
 * { row, greater } or null when there are no boss rows at all.
 */
function pickWeightedBoss(allBosses, rng = null) {
  if (!allBosses || allBosses.length === 0) return null;
  const calamity = allBosses.filter((b) => isCalamityBoss(b.name));
  const greater = allBosses.filter((b) => isGreaterBoss(b.name));
  const normal = allBosses.filter((b) => !isGreaterBoss(b.name) && !isCalamityBoss(b.name));
  const roll = typeof rng === 'function' ? rng() : chance(1);
  let pool;
  if (roll < CALAMITY_SPAWN_CHANCE) pool = calamity;
  else if (roll < CALAMITY_SPAWN_CHANCE + GREATER_SPAWN_CHANCE) pool = greater;
  else pool = normal;
  if (pool.length === 0) pool = greater.length > 0 ? greater : (normal.length > 0 ? normal : calamity);
  if (pool.length === 0) return null;
  const index = typeof rng === 'function' ? Math.floor(rng() * pool.length) : int(pool.length);
  const row = pool[index];
  return {
    row,
    greater: isGreaterBoss(row.name),
    calamity: isCalamityBoss(row.name),
    tier: bossTier(row.name),
  };
}

module.exports = {
  MAX_BOSS_ATTACKS_PER_DAY,
  bossAttackDecision,
  GREATER_BOSSES,
  CALAMITY_BOSSES,
  CALAMITY_SPAWN_CHANCE,
  GREATER_SPAWN_CHANCE,
  NORMAL_SPAWN_CHANCE,
  GREATER_CHEST_GOLDEN_CHANCE,
  GREATER_TREASURE_HP_MULTIPLIER,
  GREATER_GOLDEN_HP_MULTIPLIER,
  NORMAL_REWARD,
  GREATER_TWIN_REWARD,
  GREATER_GOLDEN_REWARD,
  CALAMITY_REWARD,
  CALAMITY_NATURAL_CHEST,
  CALAMITY_DEV_CHEST,
  GREATER_VARIANTS,
  isGreaterBoss,
  isCalamityBoss,
  bossTier,
  greaterVariantForChest,
  bossRewards,
  rollBossChest,
  hpMultiplierForChest,
  bossMaxHpForChest,
  inferChestFromGreaterHp,
  bossChestForSpawn,
  pickWeightedBoss,
};
