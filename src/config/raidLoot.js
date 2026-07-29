'use strict';

const { chance } = require('../utils/secureRng');

/**
 * raidLoot.js — raid spawn + loot constants (Master §13, mob-rebalance patch).
 *
 * Phase 7's raid command MUST read this module, not the doc. Ranges are
 * inclusive [min, max]; chances are fractions of 1. Chest values are
 * users_bag column names so reward grants map straight onto the bag row.
 *
 * Combat EXP here is COMBAT exp (user_character.combat_exp) — separate from
 * Reputation EXP (deferred to the rep phase).
 */

// Spawn roll: 80% regular / 20% elite (was 75/25 pre-rebalance).
// Within each category, all mobs of that type have equal spawn chance.
const ELITE_SPAWN_CHANCE = 0.20;

const RAID_LOOT = {
  regular: {
    win: {
      credux: [500, 1000],
      exp: [200, 300],
      shards: [5, 10],         // was 3–5
      shardChance: 1.0,
      chest: 'silver_chest',
      chestChance: 0.10,
    },
    loss: { exp: 50 },
  },
  elite: {
    win: {
      credux: [1500, 2000],
      exp: [400, 600],
      shards: [15, 20],        // was 8–10
      shardChance: 1.0,
      chest: 'gold_chest',
      chestChance: 0.20,
    },
    loss: { exp: 150 },
  },
};

function rollRaidChest(winLoot, rng = null) {
  const wonChest = typeof rng === 'function'
    ? rng() < winLoot.chestChance
    : chance(winLoot.chestChance);
  return wonChest ? winLoot.chest : null;
}

module.exports = { ELITE_SPAWN_CHANCE, RAID_LOOT, rollRaidChest };
