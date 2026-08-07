'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');
const {
  combatRewardForLevel,
  believerRewardForLevel,
  sumLevelRewards,
} = require('../src/config/levelRewards');
const {
  grantCombatLevelRewards,
  grantBelieverLevelRewards,
} = require('../src/utils/grantLevelRewards');
const { awardBelieverExp } = require('../src/utils/awardBelieverExp');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function grantClient(levels, { failBag = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('INSERT INTO combat_level_rewards') || sql.includes('INSERT INTO believer_level_rewards')) {
        return { rows: levels.map((level) => ({ level })) };
      }
      if (sql.startsWith('UPDATE users_bag SET')) {
        if (failBag) return { rows: [] };
        return { rows: [{ credux: params[1], gold_chest: params[2] || 0, boss_treasure_chest: params[2] || 0, boss_golden_chest: params[2] || 0 }] };
      }
      if (sql.includes('INSERT INTO game_logs')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

function sharedExactlyOnceClient(shared) {
  return {
    async query(sql, params = []) {
      if (sql.includes('INSERT INTO combat_level_rewards') || sql.includes('INSERT INTO believer_level_rewards')) {
        const kind = sql.includes('believer_level_rewards') ? 'believer' : 'combat';
        const rows = [];
        for (let level = params[2]; level <= params[3]; level++) {
          const key = `${kind}:${params[0]}:${level}`;
          if (shared.levels.has(key)) continue;
          shared.levels.add(key);
          rows.push({ level });
        }
        return { rows };
      }
      if (sql.startsWith('UPDATE users_bag SET')) {
        shared.bagCredits++;
        shared.credux += Number(params[1]);
        return { rows: [{ credux: shared.credux, gold_chest: 0, boss_treasure_chest: 3, boss_golden_chest: 0 }] };
      }
      if (sql.includes('INSERT INTO game_logs')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

async function main() {
  assert.deepEqual(combatRewardForLevel(10), { credux: 100_000, chests: { gold_chest: 1 } });
  assert.deepEqual(combatRewardForLevel(11), { credux: 250_000, chests: { boss_treasure_chest: 1 } });
  assert.deepEqual(combatRewardForLevel(20), { credux: 250_000, chests: { boss_treasure_chest: 1 } });
  assert.deepEqual(combatRewardForLevel(21), { credux: 500_000, chests: { boss_treasure_chest: 2 } });
  assert.deepEqual(combatRewardForLevel(40), { credux: 1_000_000, chests: { boss_treasure_chest: 3 } });
  assert.deepEqual(combatRewardForLevel(41), { credux: 5_000_000, chests: { boss_golden_chest: 1 } });
  assert.deepEqual(combatRewardForLevel(50), { credux: 5_000_000, chests: { boss_golden_chest: 1 } });
  assert.equal(combatRewardForLevel(51), null);

  assert.deepEqual(believerRewardForLevel(10), { credux: 250_000, chests: { gold_chest: 5 } });
  assert.deepEqual(believerRewardForLevel(11), { credux: 500_000, chests: { boss_treasure_chest: 5 } });
  assert.deepEqual(believerRewardForLevel(30), { credux: 1_000_000, chests: { boss_treasure_chest: 10 } });
  assert.deepEqual(believerRewardForLevel(31), { credux: 1_000_000, chests: { boss_golden_chest: 5 } });
  assert.deepEqual(believerRewardForLevel(50), { credux: 1_000_000, chests: { boss_golden_chest: 5 } });

  assert.deepEqual(sumLevelRewards('combat', [20, 21, 22]), {
    credux: 1_250_000,
    chests: { boss_treasure_chest: 5 },
  });
  assert.deepEqual(sumLevelRewards('combat', [40, 41]), {
    credux: 6_000_000,
    chests: { boss_treasure_chest: 3, boss_golden_chest: 1 },
  });
  assert.deepEqual(sumLevelRewards('believer', [20, 21, 22]), {
    credux: 2_500_000,
    chests: { boss_treasure_chest: 25 },
  });

  const crossing = grantClient([20, 21, 22]);
  const grant = await grantCombatLevelRewards(crossing, 'u1', 19, 22);
  assert.deepEqual(grant, {
    credux: 1_250_000,
    chests: { boss_treasure_chest: 5 },
    levels: [20, 21, 22],
  });

  const believerSingle = grantClient([11]);
  assert.deepEqual(await grantBelieverLevelRewards(believerSingle, 'u-believer', 10, 11), {
    credux: 500_000,
    chests: { boss_treasure_chest: 5 },
    levels: [11],
  });

  const duplicate = grantClient([]);
  assert.equal(await grantBelieverLevelRewards(duplicate, 'u1', 10, 11), null);
  assert.equal(duplicate.queries.some(({ sql }) => sql.startsWith('UPDATE users_bag SET')), false);

  const shared = { levels: new Set(), bagCredits: 0, credux: 0 };
  const attempts = await Promise.all([
    grantCombatLevelRewards(sharedExactlyOnceClient(shared), 'u2', 19, 22),
    grantCombatLevelRewards(sharedExactlyOnceClient(shared), 'u2', 19, 22),
  ]);
  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal(shared.levels.size, 3);
  assert.equal(shared.bagCredits, 1);

  const believerShared = { levels: new Set(), bagCredits: 0, credux: 0 };
  const believerAttempts = await Promise.all([
    grantBelieverLevelRewards(sharedExactlyOnceClient(believerShared), 'u4', 19, 22),
    grantBelieverLevelRewards(sharedExactlyOnceClient(believerShared), 'u4', 19, 22),
  ]);
  assert.equal(believerAttempts.filter(Boolean).length, 1);
  assert.equal(believerShared.levels.size, 3);
  assert.equal(believerShared.bagCredits, 1);

  const rollbackState = { pending: new Set(), committed: new Set() };
  const rollbackClient = {
    async query(sql, params = []) {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'ROLLBACK') { rollbackState.pending.clear(); return { rows: [] }; }
      if (sql.includes('INSERT INTO combat_level_rewards') || sql.includes('INSERT INTO believer_level_rewards')) {
        for (let level = params[2]; level <= params[3]; level++) rollbackState.pending.add(level);
        return { rows: [...rollbackState.pending].map((level) => ({ level })) };
      }
      if (sql.startsWith('UPDATE users_bag SET')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await rollbackClient.query('BEGIN');
  await assert.rejects(grantCombatLevelRewards(rollbackClient, 'u3', 9, 10), /no users_bag row/);
  await rollbackClient.query('ROLLBACK');
  assert.equal(rollbackState.pending.size, 0);
  assert.equal(rollbackState.committed.size, 0);

  await rollbackClient.query('BEGIN');
  await assert.rejects(grantBelieverLevelRewards(rollbackClient, 'u5', 9, 10), /no users_bag row/);
  await rollbackClient.query('ROLLBACK');
  assert.equal(rollbackState.pending.size, 0);

  const grantSource = source('src/utils/grantLevelRewards.js');
  assert(grantSource.includes('ORDER BY discord_id FOR UPDATE'));
  assert(grantSource.indexOf('SELECT 1 FROM users_bag') < grantSource.indexOf('UPDATE users_bag ub'));

  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const believerQueries = [];
  const today = new Date('2026-07-20T00:00:00.000Z');
  pool.query = async (sql) => {
    believerQueries.push(sql);
    return { rows: [{ believer_exp: 0 }] };
  };
  pool.connect = async () => ({
    release() {},
    async query(sql) {
      believerQueries.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT believer_level')) {
        return { rows: [{ believer_level: 1, believer_exp: 0, reputation_exp_today: 0, reputation_exp_reset_date: today, pht_today: today }] };
      }
      if (sql.startsWith('UPDATE user_character')) return { rows: [] };
      if (sql.includes('INSERT INTO user_titles')) return { rows: [] };
      throw new Error(`Unexpected believer query: ${sql}`);
    },
  });
  try {
    const fast = await awardBelieverExp('u-fast', 3);
    assert.deepEqual(fast, { awarded: 3, levelUp: null });
    assert.equal(believerQueries.some((sql) => sql.includes('users_bag')), false);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }

  console.log('LEVEL REWARDS SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
