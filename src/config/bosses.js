'use strict';

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

// EXACT mob_roster.name values. "Jotun" is the seeded spelling of Jötunn.
const GREATER_BOSSES = new Set(['Jotun', 'Fenrir', 'Fafnir', 'Hydra', 'Cerberus']);

const GREATER_SPAWN_CHANCE = 0.20;       // 20% Greater / 80% normal (tier roll on top of spawn cadence)
const GREATER_HP_MULTIPLIER = 2;         // Treasure-chest Greater Boss: 2× the scaled max HP (HP only)
const GREATER_HP_GOLDEN_MULTIPLIER = 3;  // [RenderTweaks] Golden-chest Greater Boss: 3× HP (rarer + tankier)
const GREATER_CHEST_GOLDEN_CHANCE = 0.20; // Greater chest: 20% → 1× Boss Golden Chest, else 2× Boss Treasure

// §16 participation rewards (every attacker of the spawn receives these).
const NORMAL_REWARD  = { credux: 100_000, exp: 20_000, shards: 1_000 };
const GREATER_REWARD = { credux: 150_000, exp: 30_000, shards: 1_000 };

function isGreaterBoss(name) {
  return GREATER_BOSSES.has(name);
}

/** Reward bundle (credux/exp/shards) for a boss by name. */
function bossRewards(name) {
  return isGreaterBoss(name) ? GREATER_REWARD : NORMAL_REWARD;
}

/**
 * Roll the chest reward for a defeated boss. Column is from a fixed whitelist
 * (boss_treasure_chest / boss_golden_chest) — safe to interpolate into SQL.
 * Normal boss → 1× Boss Treasure Chest. Greater → 80% 2× Treasure / 20% 1× Golden.
 * For a Greater Boss the roll is made ONCE per defeat (every attacker gets the same
 * outcome), matching the uniform participation model.
 */
function rollBossChest(name, rng = Math.random) {
  if (!isGreaterBoss(name)) {
    return { column: 'boss_treasure_chest', qty: 1, label: 'Boss Treasure Chest' };
  }
  return rng() < GREATER_CHEST_GOLDEN_CHANCE
    ? { column: 'boss_golden_chest', qty: 1, label: 'Boss Golden Chest' }
    : { column: 'boss_treasure_chest', qty: 2, label: 'Boss Treasure Chest' };
}

/**
 * [RenderTweaks] HP multiplier for a Greater Boss derived from the chest rolled at spawn:
 * a Boss Golden Chest (the rare 20% outcome) → 3× HP; the common Boss Treasure Chest → 2× HP.
 * The chest is rolled ONCE at spawn (rollBossChest) and drives both this HP mult and the
 * payout, so the rarer chest is also the tankier fight.
 */
function hpMultiplierForChest(chest) {
  return chest && chest.column === 'boss_golden_chest'
    ? GREATER_HP_GOLDEN_MULTIPLIER
    : GREATER_HP_MULTIPLIER;
}

/**
 * Pick a boss row with the weighted tier roll: 20% Greater / 80% normal, then
 * uniform within the chosen pool. Falls back to the other pool if one is empty so
 * a missing Greater seed (or an all-Greater roster) never crashes. Returns
 * { row, greater } or null when there are no boss rows at all.
 */
function pickWeightedBoss(allBosses, rng = Math.random) {
  if (!allBosses || allBosses.length === 0) return null;
  const greater = allBosses.filter((b) => isGreaterBoss(b.name));
  const normal = allBosses.filter((b) => !isGreaterBoss(b.name));
  const wantGreater = rng() < GREATER_SPAWN_CHANCE;
  let pool = wantGreater ? greater : normal;
  if (pool.length === 0) pool = wantGreater ? normal : greater; // fall back if chosen pool empty
  if (pool.length === 0) return null;
  const row = pool[Math.floor(rng() * pool.length)];
  return { row, greater: isGreaterBoss(row.name) };
}

module.exports = {
  GREATER_BOSSES,
  GREATER_SPAWN_CHANCE,
  GREATER_HP_MULTIPLIER,
  GREATER_HP_GOLDEN_MULTIPLIER,
  GREATER_CHEST_GOLDEN_CHANCE,
  NORMAL_REWARD,
  GREATER_REWARD,
  isGreaterBoss,
  bossRewards,
  rollBossChest,
  hpMultiplierForChest,
  pickWeightedBoss,
};
