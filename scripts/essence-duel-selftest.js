'use strict';

const assert = require('node:assert/strict');
const exchange = require('../src/commands/rpg/exchangeEssence');
const duel = require('../src/commands/rpg/duel');
const {
  QUEST_DEFS, QUEST_TYPES, DAILY_DIFFICULTY_REWARDS,
  WEEKLY_QUEST_DEFS, WEEKLY_QUEST_TYPES, WEEKLY_QUEST_CREDUX,
} = require('../src/utils/questProgress');
const { ESSENCE_COLUMN, ESSENCE_CONVERT } = require('../src/config/runes');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
}

async function expect(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name} — ${err.message}`);
  }
}

class ExchangeClient {
  constructor({ bag, updated = bag, duplicate = false }) {
    this.bag = bag;
    this.updated = updated;
    this.duplicate = duplicate;
    this.sql = [];
    this.params = [];
  }

  async query(sql, params = []) {
    this.sql.push(sql);
    this.params.push(params);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('INSERT INTO essence_exchange_submissions')) {
      return this.duplicate ? { rows: [] } : { rows: [{ submission_id: params[0] }] };
    }
    if (sql.includes('FROM users_bag') && sql.includes('FOR UPDATE')) return { rows: [this.bag] };
    if (sql.startsWith('UPDATE users_bag')) return { rowCount: 1, rows: [] };
    if (sql.includes("INSERT INTO game_logs")) return { rows: [] };
    if (sql.includes('FROM users_bag')) return { rows: [this.updated] };
    throw new Error(`unexpected query: ${sql}`);
  }
}

function bagFor(tier, conversions, creduxConversions = conversions) {
  const def = ESSENCE_CONVERT[tier];
  return {
    credux: def.credux * creduxConversions,
    epic_essence: 0,
    mythic_essence: 0,
    legendary_essence: 0,
    supreme_essence: 0,
    [ESSENCE_COLUMN[def.from]]: def.amount * conversions,
  };
}

async function run() {
  const shown = { modal: null };
  await expect('Convert button opens the amount modal', async () => {
    await exchange.handleConvert({
      user: { id: '42' },
      showModal: async (modal) => { shown.modal = modal.toJSON(); },
    }, '42', 'mythic');
    assert.equal(shown.modal.title, 'Convert Essence');
    assert.match(shown.modal.custom_id, /^essx:amount:42:mythic:/);
    assert.equal(shown.modal.components[0].components[0].label, 'Conversion Amount');
    assert.equal(shown.modal.components[0].components[0].placeholder, 'Enter the number of conversions');
  });

  check('amount validation rejects invalid values', [
    '', '0', '-1', '1.5', 'abc', '1e2', '9007199254740992', '1000001',
  ].every((value) => exchange.parseConversionAmount(value) === null));
  check('amount validation accepts positive whole values', exchange.parseConversionAmount('01') === 1
    && exchange.parseConversionAmount('5') === 5);

  for (const tier of Object.keys(ESSENCE_CONVERT)) {
    const def = ESSENCE_CONVERT[tier];
    const bag = bagFor(tier, 3);
    check(`${tier} recipe max affordable count`, exchange.maxAffordableConversions(def, bag) === 3);
    check(`${tier} one-unit recipe remains unchanged`, def.amount === 10 && def.credux > 0);
  }

  const mythicDef = ESSENCE_CONVERT.mythic;
  const bulkBag = { ...bagFor('mythic', 10), mythic_essence: 4 };
  const bulkUpdated = { ...bulkBag, epic_essence: 50, mythic_essence: 9, credux: 250000 };
  const bulkClient = new ExchangeClient({ bag: bulkBag, updated: bulkUpdated });
  const bulkResult = await exchange.convertBulk(bulkClient, '42', 'mythic', 5, '11111111-1111-4111-8111-111111111111');
  check('valid quantity performs multiple conversions', bulkResult.status === 'done' && bulkResult.amount === 5);
  check('recipe costs and crafted rewards scale once', bulkResult.requiredFrom === 50
    && bulkResult.requiredCredux === 250000
    && bulkClient.params.some((params) => params[1] === 50 && params[2] === 250000 && params[3] === 5));
  check('bulk conversion is one atomic balance update', bulkClient.sql.filter((sql) => sql.startsWith('UPDATE users_bag')).length === 1
    && bulkClient.sql.filter((sql) => sql === 'COMMIT').length === 1);

  const lowEssence = { ...bagFor('mythic', 7, 8), credux: 420000 };
  const lowEssenceClient = new ExchangeClient({ bag: lowEssence });
  const lowEssenceResult = await exchange.convertBulk(lowEssenceClient, '42', 'mythic', 10, '22222222-2222-4222-8222-222222222222');
  check('insufficient essence rejects the entire conversion', lowEssenceResult.status === 'insufficient'
    && lowEssenceResult.maxConversions === 7
    && !lowEssenceClient.sql.some((sql) => sql.startsWith('UPDATE users_bag')));

  const lowCredux = { ...bagFor('mythic', 10, 8), credux: 420000 };
  const lowCreduxClient = new ExchangeClient({ bag: lowCredux });
  const lowCreduxResult = await exchange.convertBulk(lowCreduxClient, '42', 'mythic', 10, '33333333-3333-4333-8333-333333333333');
  check('insufficient Credux rejects the entire conversion', lowCreduxResult.status === 'insufficient'
    && lowCreduxResult.maxConversions === 8
    && lowCreduxClient.sql.filter((sql) => sql === 'ROLLBACK').length === 1);

  const duplicateClient = new ExchangeClient({ bag: bagFor('mythic', 10), duplicate: true });
  const duplicateResult = await exchange.convertBulk(duplicateClient, '42', 'mythic', 5, '44444444-4444-4444-8444-444444444444');
  check('duplicate modal submission is idempotent', duplicateResult.status === 'duplicate'
    && !duplicateClient.sql.some((sql) => sql.startsWith('UPDATE users_bag'))
    && !duplicateClient.sql.includes('COMMIT'));

  check('future daily quest pool contains only the unified duel quest', QUEST_TYPES.includes('duel_participations')
    && !QUEST_TYPES.includes('duel_wins') && !QUEST_TYPES.includes('duel_challenges'));
  check('future weekly quest pool contains only the unified duel quest', WEEKLY_QUEST_TYPES.includes('duel_participations')
    && !WEEKLY_QUEST_TYPES.includes('duel_wins') && WEEKLY_QUEST_TYPES.length === 5);
  check('daily unified duel target is retained and its Mid reward is fixed', QUEST_DEFS.duel_participations.roll(() => 0) === 2
    && QUEST_DEFS.duel_participations.roll(() => 0.999) === 5
    && QUEST_DEFS.duel_participations.difficulty === 'Mid'
    && QUEST_DEFS.duel_participations.reward(2).join(',') === '50000,750'
    && QUEST_DEFS.duel_participations.reward(5).join(',') === '50000,750');
  check('daily difficulty reward map is exact', JSON.stringify(DAILY_DIFFICULTY_REWARDS) === JSON.stringify({
    Easy: [30000, 500], Mid: [50000, 750], Hard: [100000, 1000],
  }));
  check('daily quest types use the requested classifications', QUEST_DEFS.raid_wins.difficulty === 'Easy'
    && QUEST_DEFS.elite_defeats.difficulty === 'Hard'
    && QUEST_DEFS.credux_spent.difficulty === 'Hard'
    && QUEST_DEFS.weapon_enhancements.difficulty === 'Hard'
    && QUEST_DEFS.duel_wins.difficulty === 'Mid'
    && QUEST_DEFS.duel_challenges.difficulty === 'Mid'
    && QUEST_DEFS.duel_participations.difficulty === 'Mid');
  check('weekly unified duel target and reward are retained', WEEKLY_QUEST_DEFS.duel_participations.roll(() => 0) === 5
    && WEEKLY_QUEST_DEFS.duel_participations.roll(() => 0.999) === 12
    && WEEKLY_QUEST_DEFS.duel_participations.reward(12).join(',') === '100000,50'
    && WEEKLY_QUEST_CREDUX === 100000);
  check('legacy quest definitions remain available for assigned rows', Boolean(QUEST_DEFS.duel_wins)
    && Boolean(QUEST_DEFS.duel_challenges) && Boolean(WEEKLY_QUEST_DEFS.duel_wins));

  const progressCalls = [];
  const progress = async (_client, id, deltas) => {
    progressCalls.push({ id, deltas });
    return [];
  };
  const duelClient = {
    connect: async () => ({
      async query(sql) {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('INSERT INTO pvp_logs')) return { rows: [{ id: 1 }] };
        return { rows: [] };
      },
      release() {},
    }),
  };
  await duel.commitDuelResult(
    '55555555-5555-4555-8555-555555555555', 'a', 'b',
    { winner: 'draw', outcome: 'forfeit', totals: { damageDealtToEnemy: 1, damageDealtToPlayer: 2 } },
    duelClient, progress,
  );
  const byId = Object.fromEntries(progressCalls.map((call) => [call.id, call.deltas]));
  check('completed draw or forfeit grants one unified progress to both participants', byId.a?.duel_participations === 1
    && byId.b?.duel_participations === 1);
  check('legacy challenge progress is preserved without a draw winner reward', byId.a?.duel_challenges === 1
    && !byId.a?.duel_wins && !byId.b?.duel_wins);

  progressCalls.length = 0;
  const duplicateDuelClient = {
    connect: async () => ({
      async query(sql) {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('INSERT INTO pvp_logs')) return { rows: [] };
        return { rows: [] };
      },
      release() {},
    }),
  };
  await duel.commitDuelResult(
    '55555555-5555-4555-8555-555555555555', 'a', 'b',
    { winner: 'a', outcome: 'normal', totals: { damageDealtToEnemy: 1, damageDealtToPlayer: 2 } },
    duplicateDuelClient, progress,
  );
  check('duplicate duel completion does not repeat quest progress', progressCalls.length === 0);

  console.log(`ESSENCE_DUEL ${JSON.stringify({ passed, failed })}`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
