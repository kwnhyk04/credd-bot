'use strict';

const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { sumLevelRewards } = require('../src/config/levelRewards');
const {
  addGrant,
  dryRunBatch,
  executeBatch,
  missingLevels,
  newTotals,
} = require('./level-reward-compensation');

function expectedDryTotals(users, combatRows, believerRows) {
  const totals = newTotals();
  const grouped = (rows) => rows.reduce((map, row) => {
    const list = map.get(row.discord_id) || [];
    list.push(row);
    map.set(row.discord_id, list);
    return map;
  }, new Map());
  const combat = grouped(combatRows);
  const believer = grouped(believerRows);
  for (const user of users) {
    const combatLevels = missingLevels(user.combat_level, combat.get(user.discord_id) || []);
    const believerLevels = missingLevels(user.believer_level, believer.get(user.discord_id) || []);
    if (combatLevels.length) addGrant(totals, { ...sumLevelRewards('combat', combatLevels), levels: combatLevels });
    if (believerLevels.length) addGrant(totals, { ...sumLevelRewards('believer', believerLevels), levels: believerLevels });
  }
  return totals;
}

function executionClient(userId, mode, released) {
  let bagCredux = 0;
  return {
    release() { released.push(userId); },
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT 1 FROM users_bag')) {
        if (mode === 'fail') throw new Error('isolated failure');
        return { rows: mode === 'skip' ? [] : [{ '?column?': 1 }] };
      }
      if (sql.includes('INSERT INTO combat_level_rewards') || sql.includes('INSERT INTO believer_level_rewards')) {
        return { rows: [{ level: 2 }] };
      }
      if (sql.startsWith('UPDATE users_bag SET')) {
        bagCredux += Number(params[1]);
        return {
          rows: [{
            credux: bagCredux,
            gold_chest: sql.includes('gold_chest =') ? Number(params[2] || 0) : 0,
            boss_treasure_chest: 0,
            boss_golden_chest: 0,
          }],
        };
      }
      if (sql.includes('INSERT INTO game_logs')) return { rows: [] };
      throw new Error(`Unexpected execution query: ${sql}`);
    },
  };
}

async function main() {
  assert.deepEqual(missingLevels(1, []), []);
  assert.deepEqual(missingLevels(5, [{ level: 2 }, { level: 4 }]), [3, 5]);
  assert.deepEqual(missingLevels(999, [{ level: 2 }, { level: 50 }]).slice(-2), [48, 49]);

  const combatAll = sumLevelRewards('combat', Array.from({ length: 49 }, (_, i) => i + 2));
  assert.deepEqual(combatAll, {
    credux: 68_400_000,
    chests: { gold_chest: 9, boss_treasure_chest: 60, boss_golden_chest: 10 },
  });
  const believerAll = sumLevelRewards('believer', Array.from({ length: 49 }, (_, i) => i + 2));
  assert.deepEqual(believerAll, {
    credux: 37_250_000,
    chests: { gold_chest: 45, boss_treasure_chest: 150, boss_golden_chest: 100 },
  });

  const users = [
    { discord_id: 'combat-only', combat_level: 3, believer_level: 1 },
    { discord_id: 'believer-only', combat_level: 1, believer_level: 3 },
    { discord_id: 'both', combat_level: 3, believer_level: 3 },
    { discord_id: 'partial', combat_level: 3, believer_level: 1 },
    { discord_id: 'full', combat_level: 3, believer_level: 3 },
  ];
  const combatRows = [
    { discord_id: 'partial', level: 2 },
    { discord_id: 'full', level: 2 },
    { discord_id: 'full', level: 3 },
  ];
  const believerRows = [
    { discord_id: 'full', level: 2 },
    { discord_id: 'full', level: 3 },
  ];

  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const seenSql = [];
  let readIndex = 0;
  pool.query = async (sql) => {
    seenSql.push(sql);
    const rows = readIndex++ === 0 ? combatRows : believerRows;
    return { rows };
  };
  const totals = newTotals();
  const counters = { checked: 0, compensated: 0, skipped: 0, failed: 0 };
  try {
    await dryRunBatch(users, totals, counters);
  } finally {
    pool.query = originalQuery;
  }
  assert.deepEqual(counters, { checked: 5, compensated: 4, skipped: 1, failed: 0 });
  assert.deepEqual(totals, expectedDryTotals(users, combatRows, believerRows));
  assert(seenSql.every((sql) => /^SELECT\s/i.test(sql.trim())));

  const fullyRewarded = users.flatMap((user) => [2, 3].map((level) => ({ discord_id: user.discord_id, level })));
  let rerunIndex = 0;
  pool.query = async () => ({ rows: rerunIndex++ === 0 ? fullyRewarded : fullyRewarded });
  const rerunTotals = newTotals();
  const rerunCounters = { checked: 0, compensated: 0, skipped: 0, failed: 0 };
  try {
    await dryRunBatch(users, rerunTotals, rerunCounters);
  } finally {
    pool.query = originalQuery;
  }
  assert.deepEqual(rerunCounters, { checked: 5, compensated: 0, skipped: 5, failed: 0 });
  assert.deepEqual(rerunTotals, newTotals());

  const released = [];
  const modes = new Map([['ok', 'ok'], ['fail', 'fail'], ['skip', 'skip']]);
  pool.connect = async () => {
    const [userId, mode] = modes.entries().next().value;
    modes.delete(userId);
    return executionClient(userId, mode, released);
  };
  const executeTotals = newTotals();
  const executeCounters = { checked: 0, compensated: 0, skipped: 0, failed: 0 };
  const failedIds = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    await executeBatch([
      { discord_id: 'ok', combat_level: 2, believer_level: 2 },
      { discord_id: 'fail', combat_level: 2, believer_level: 2 },
      { discord_id: 'skip', combat_level: 2, believer_level: 2 },
    ], executeTotals, executeCounters, failedIds);
  } finally {
    console.error = originalError;
    pool.connect = originalConnect;
  }
  assert.deepEqual(executeCounters, { checked: 3, compensated: 1, skipped: 1, failed: 1 });
  assert.deepEqual(failedIds, ['fail']);
  assert.deepEqual(released.sort(), ['fail', 'ok', 'skip']);
  assert.equal(executeTotals.credux, 350_000);
  assert.equal(executeTotals.chests.gold_chest, 6);

  console.log('COMPENSATION SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
