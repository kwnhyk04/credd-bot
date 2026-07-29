'use strict';

const { chance, int } = require('../utils/secureRng');

/**
 * Greater Boss tier — Master §16 [v4.4].
 *
 * Apex boss variants. This module is the SINGLE source of truth for both the spawn
 * weighting AND the reward payout, so the spawn announcement and the defeat
 * distribution can never disagree about a boss's greater-ness or its rewards.
 *
 * Greater-ness is matched by EXACT mob_roster name. The five intended Greater Bosses
 * are Jötunn / Fenrir / Fafnir / Hydra / Cerberus — the Norse giant is seeded as
 * "Jotun" (no diacritic) in mob_roster, so that's the name we match. If a name here
 * isn't actually seeded, it simply never matches a row (the spawn pool skips it).
 */

// Max boss attacks a player may make per day (PHT clock). The limit resets at
// midnight PHT and applies across all active boss spawns.
const MAX_BOSS_ATTACKS_PER_DAY = 2;

// EXACT mob_roster.name values. "Jotun" is the seeded spelling of Jötunn.
const GREATER_BOSSES = new Set(['Jotun', 'Fenrir', 'Fafnir', 'Hydra', 'Cerberus']);

const GREATER_SPAWN_CHANCE = 0.30;
const GREATER_CHEST_GOLDEN_CHANCE = 0.25;
const GREATER_TREASURE_HP_MULTIPLIER = 2;
const GREATER_GOLDEN_HP_MULTIPLIER = 3;

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
 * Normal 1× Treasure and unknown outcomes deliberately remain 1×.
 */
function hpMultiplierForChest(chest) {
  return greaterVariantForChest(chest)?.hpMultiplier || 1;
}

/**
 * Apply a Greater multiplier to base HP before adding the existing level scale.
 * Normal bosses pass a null chest and retain the original base + per-level formula.
 */
function bossMaxHpForChest(baseHp, hpPerLevel, level, chest = null) {
  const base = Number(baseHp);
  const perLevel = Number(hpPerLevel);
  const lv = Math.max(1, Number(level));
  if (![base, perLevel, lv].every(Number.isFinite)) return 1;
  return Math.max(1, Math.floor(base * hpMultiplierForChest(chest) + perLevel * lv));
}

/**
 * Recover a Greater spawn's fixed chest after a process restart from persisted
 * max HP. Legacy formulas remain readable until every pre-change spawn is gone.
 */
function inferChestFromGreaterHp(baseHp, maxHp, { hpPerLevel = 0, level = 0 } = {}) {
  const base = Math.floor(Number(baseHp));
  const persisted = Math.floor(Number(maxHp));
  const perLevel = Number(hpPerLevel);
  const lv = Math.max(0, Number(level));
  if (
    !Number.isFinite(base) || base <= 0
    || !Number.isFinite(persisted)
    || !Number.isFinite(perLevel)
    || !Number.isFinite(lv)
  ) {
    return null;
  }

  const scaledHp = perLevel * lv;
  const variants = [GREATER_VARIANTS.golden, GREATER_VARIANTS.twin];
  for (const variant of variants) {
    if (persisted === Math.floor(base * variant.hpMultiplier + scaledHp)) {
      return { ...variant.chest };
    }
  }

  const legacyBaseHp = Math.floor(base + scaledHp);
  const legacyVariants = [
    [2, GREATER_VARIANTS.golden],
    [1.5, GREATER_VARIANTS.twin],
  ];
  for (const [legacyMultiplier, variant] of legacyVariants) {
    if (persisted === Math.floor(legacyBaseHp * legacyMultiplier)) {
      return { ...variant.chest };
    }
  }
  return null;
}

/**
 * Pick a boss row with the weighted tier roll: 30% Greater / 70% normal, then
 * uniform within the chosen pool. Falls back to the other pool if one is empty so
 * a missing Greater seed (or an all-Greater roster) never crashes. Returns
 * { row, greater } or null when there are no boss rows at all.
 */
function pickWeightedBoss(allBosses, rng = null) {
  if (!allBosses || allBosses.length === 0) return null;
  const greater = allBosses.filter((b) => isGreaterBoss(b.name));
  const normal = allBosses.filter((b) => !isGreaterBoss(b.name));
  const wantGreater = typeof rng === 'function'
    ? rng() < GREATER_SPAWN_CHANCE
    : chance(GREATER_SPAWN_CHANCE);
  let pool = wantGreater ? greater : normal;
  if (pool.length === 0) pool = wantGreater ? normal : greater; // fall back if chosen pool empty
  if (pool.length === 0) return null;
  const index = typeof rng === 'function' ? Math.floor(rng() * pool.length) : int(pool.length);
  const row = pool[index];
  return { row, greater: isGreaterBoss(row.name) };
}

module.exports = {
  MAX_BOSS_ATTACKS_PER_DAY,
  bossAttackDecision,
  GREATER_BOSSES,
  GREATER_SPAWN_CHANCE,
  GREATER_CHEST_GOLDEN_CHANCE,
  GREATER_TREASURE_HP_MULTIPLIER,
  GREATER_GOLDEN_HP_MULTIPLIER,
  NORMAL_REWARD,
  GREATER_TWIN_REWARD,
  GREATER_GOLDEN_REWARD,
  GREATER_VARIANTS,
  isGreaterBoss,
  greaterVariantForChest,
  bossRewards,
  rollBossChest,
  hpMultiplierForChest,
  bossMaxHpForChest,
  inferChestFromGreaterHp,
  pickWeightedBoss,
};
