'use strict';

const { chance, int, unit } = require('../utils/secureRng');
const { BAGS } = require('./runes');

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
const CALAMITY_PARTICIPATION_CHEST = Object.freeze({
  column: 'boss_golden_chest', qty: 1, label: 'Boss Golden Chest',
});
const CALAMITY_NATURAL_CHEST = Object.freeze({
  ...CALAMITY_PARTICIPATION_CHEST,
});
const CALAMITY_DEV_CHEST = Object.freeze({
  ...CALAMITY_PARTICIPATION_CHEST,
});

const GREATER_VARIANTS = Object.freeze({
  twin: Object.freeze({
    key: 'twin',
    label: 'Twin Chest',
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
 * Guaranteed rune-bag reward for the fixed boss spawn variant. Item columns,
 * names, and emoji keys come from the existing rune-bag registry. The Greater
 * Golden variant receives exactly two Greater Bags; rewards do not inherit
 * from lower tiers.
 */
function bossBagReward(name, chest = null) {
  let bag = BAGS.lesser;
  let qty = 1;
  if (isCalamityBoss(name)) {
    bag = BAGS.greater;
    qty = 3;
  } else if (isGreaterBoss(name)) {
    bag = BAGS.greater;
    qty = greaterVariantForChest(chest)?.key === 'golden' ? 2 : 1;
  }
  return {
    column: bag.column,
    qty,
    label: bag.name,
    emojiName: bag.emojiName,
  };
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
 * Resolve max HP from the database value. Legacy arguments are accepted for
 * callers that still pass level/chest context, but no tier adjustment applies.
 */
function bossMaxHpForChest(baseHp, hpPerLevel, level, chest = null, bossName = null) {
  const base = Number(baseHp);
  if (!Number.isFinite(base)) return 1;
  return Math.max(1, Math.floor(base));
}

function bossChestForSpawn(name, spawnSource = 'natural', rng = null) {
  if (!isCalamityBoss(name)) return rollBossChest(name, rng);
  return spawnSource === 'dev' ? { ...CALAMITY_DEV_CHEST } : { ...CALAMITY_NATURAL_CHEST };
}

/** Choose the tier pool without changing the established 5% / 25% / 70% odds. */
function selectWeightedBossPool(allBosses, rng = null) {
  if (!allBosses || allBosses.length === 0) return null;
  const calamity = allBosses.filter((b) => isCalamityBoss(b.name));
  const greater = allBosses.filter((b) => isGreaterBoss(b.name));
  const normal = allBosses.filter((b) => !isGreaterBoss(b.name) && !isCalamityBoss(b.name));
  const roll = typeof rng === 'function' ? rng() : unit();
  let pool;
  if (roll < CALAMITY_SPAWN_CHANCE) pool = calamity;
  else if (roll < CALAMITY_SPAWN_CHANCE + GREATER_SPAWN_CHANCE) pool = greater;
  else pool = normal;
  if (pool.length === 0) pool = greater.length > 0 ? greater : (normal.length > 0 ? normal : calamity);
  return pool.length > 0 ? pool : null;
}

/**
 * Reconstruct the unused portion of a shuffled bag from persistent spawn history.
 * `recentMobIds` is newest-first and `totalSpawns` counts prior spawns in this
 * currently eligible tier pool. A topology change can make old history imperfect;
 * the fallbacks retain fairness and, whenever possible, avoid an immediate repeat.
 */
function rotationCandidates(pool, { recentMobIds = [], totalSpawns = 0 } = {}) {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  if (pool.length === 1) return [...pool];

  const position = Math.max(0, Number(totalSpawns) || 0) % pool.length;
  const currentBagIds = new Set(
    recentMobIds.slice(0, position).map((mobId) => String(mobId))
  );
  let candidates = pool.filter((row) => !currentBagIds.has(String(row.mob_id)));

  const previousId = recentMobIds[0] == null ? null : String(recentMobIds[0]);
  if (position === 0 && previousId != null) {
    candidates = candidates.filter((row) => String(row.mob_id) !== previousId);
  }
  if (candidates.length === 0 && previousId != null) {
    candidates = pool.filter((row) => String(row.mob_id) !== previousId);
  }
  return candidates.length > 0 ? candidates : [...pool];
}

function pickBossFromPool(pool, rotationState = {}, rng = null) {
  const candidates = rotationCandidates(pool, rotationState);
  if (candidates.length === 0) return null;
  const roll = typeof rng === 'function' ? rng() : null;
  const index = roll == null
    ? int(candidates.length)
    : Math.min(candidates.length - 1, Math.floor(Math.max(0, roll) * candidates.length));
  const row = candidates[index];
  return {
    row,
    greater: isGreaterBoss(row.name),
    calamity: isCalamityBoss(row.name),
    tier: bossTier(row.name),
  };
}

/**
 * Pick a boss row with the weighted tier roll, then uniformly within that tier.
 * The optional rotation state lets callers apply the same shuffled-bag policy;
 * callers that need to load state after seeing the selected tier can use the two
 * helpers above. Returns null only when the full roster is empty.
 */
function pickWeightedBoss(allBosses, rng = null, rotationState = {}) {
  const pool = selectWeightedBossPool(allBosses, rng);
  return pickBossFromPool(pool, rotationState, rng);
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
  NORMAL_REWARD,
  GREATER_TWIN_REWARD,
  GREATER_GOLDEN_REWARD,
  CALAMITY_REWARD,
  CALAMITY_PARTICIPATION_CHEST,
  CALAMITY_NATURAL_CHEST,
  CALAMITY_DEV_CHEST,
  GREATER_VARIANTS,
  isGreaterBoss,
  isCalamityBoss,
  bossTier,
  greaterVariantForChest,
  bossRewards,
  bossBagReward,
  rollBossChest,
  bossMaxHpForChest,
  bossChestForSpawn,
  selectWeightedBossPool,
  rotationCandidates,
  pickBossFromPool,
  pickWeightedBoss,
};
