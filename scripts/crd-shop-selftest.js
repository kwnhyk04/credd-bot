'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
const { CRD_SHOP, periodKey, nextReset } = require('../src/config/crdShop');
const { buildShop, buy } = require('../src/commands/rpg/crdShop');
const { emoji } = require('../src/utils/emojis');

function messageFor(userId = 'shop-user') {
  const replies = [];
  return {
    message: {
      author: { id: userId },
      async reply(payload) { replies.push(payload); return payload; },
    },
    replies,
  };
}

function installFakePool(shared, { failInventory = false } = {}) {
  let locked = false;
  const waiters = [];
  let connects = 0;

  async function acquire() {
    if (locked) await new Promise((resolve) => waiters.push(resolve));
    locked = true;
  }

  function releaseLock() {
    locked = false;
    const next = waiters.shift();
    if (next) next();
  }

  pool.connect = async () => {
    connects++;
    let tx = null;
    let ownsLock = false;
    let ended = false;
    return {
      release() {
        if (ownsLock) releaseLock();
      },
      async query(sql, params = []) {
        if (sql === 'BEGIN') return { rows: [] };
        if (sql === 'COMMIT') {
          shared.bag = { ...tx.bag };
          shared.tracking = new Map(tx.tracking);
          ended = true;
          if (ownsLock) { ownsLock = false; releaseLock(); }
          return { rows: [] };
        }
        if (sql === 'ROLLBACK') {
          ended = true;
          if (ownsLock) { ownsLock = false; releaseLock(); }
          return { rows: [] };
        }
        if (sql.includes('SELECT credux FROM users_bag')) {
          await acquire();
          ownsLock = true;
          tx = { bag: { ...shared.bag }, tracking: new Map(shared.tracking) };
          return { rows: shared.missingBag ? [] : [{ credux: tx.bag.credux }] };
        }
        if (sql.includes('SELECT qty FROM crd_shop_purchases')) {
          const key = `${params[0]}:${params[1]}:${params[2]}`;
          return { rows: tx.tracking.has(key) ? [{ qty: tx.tracking.get(key) }] : [] };
        }
        if (sql.includes('INSERT INTO crd_shop_purchases')) {
          const key = `${params[0]}:${params[1]}:${params[2]}`;
          const current = Number(tx.tracking.get(key) || 0);
          if (current + Number(params[3]) > Number(params[4])) return { rows: [] };
          const qty = current + Number(params[3]);
          tx.tracking.set(key, qty);
          return { rows: [{ qty }] };
        }
        if (sql.startsWith('UPDATE users_bag SET credux')) {
          if (failInventory) throw new Error('inventory credit failed');
          const item = CRD_SHOP.find((product) => sql.includes(`${product.column} = ${product.column} +`));
          tx.bag.credux -= Number(params[1]);
          tx.bag[item.column] = Number(tx.bag[item.column] || 0) + Number(params[2]);
          return { rows: [{ credux: tx.bag.credux, item_count: tx.bag[item.column] }] };
        }
        if (sql.includes('INSERT INTO game_logs')) return { rows: [] };
        throw new Error(`Unexpected shop query: ${sql}`);
      },
    };
  };

  return { connects: () => connects, isClean: () => !locked && waiters.length === 0 };
}

async function main() {
  const shopSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'commands', 'rpg', 'crdShop.js'),
    'utf8',
  );
  assert.match(emoji('credux_coin'), /^<:credux_coin:\d+>$/);
  assert.match(shopSource, /const CREDUX = emoji\('credux_coin'\);/);
  assert.doesNotMatch(shopSource, /🪙/);
  assert((shopSource.match(/\$\{CREDUX\}/g) || []).length >= 4);

  assert.deepEqual(CRD_SHOP.map((item) => item.id), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(CRD_SHOP.map((item) => item.column), [
    'change_class', 'lesser_rune_bag', 'greater_rune_bag', 'divine_rune_bag',
    'silver_chest', 'gold_chest', 'diamond_chest',
  ]);
  assert.deepEqual(
    CRD_SHOP.map((item) => item.price),
    [5_000_000, 1_000_000, 2_000_000, 5_000_000, 5_000, 50_000, 500_000],
  );

  const beforeDaily = new Date('2026-07-20T15:59:59.000Z');
  const afterDaily = new Date('2026-07-20T16:00:00.000Z');
  assert.equal(periodKey('daily', beforeDaily), 20260720);
  assert.equal(periodKey('daily', afterDaily), 20260721);
  assert.equal(nextReset('daily', beforeDaily).toISOString(), '2026-07-20T16:00:00.000Z');

  const beforeWeek = new Date('2026-07-19T15:59:59.000Z');
  const afterWeek = new Date('2026-07-19T16:00:00.000Z');
  assert.notEqual(periodKey('weekly', beforeWeek), periodKey('weekly', afterWeek));
  assert.equal(nextReset('weekly', beforeWeek).toISOString(), '2026-07-19T16:00:00.000Z');

  const beforeMonth = new Date('2026-07-31T15:59:59.000Z');
  const afterMonth = new Date('2026-07-31T16:00:00.000Z');
  assert.equal(periodKey('monthly', beforeMonth), 202607);
  assert.equal(periodKey('monthly', afterMonth), 202608);
  assert.equal(nextReset('monthly', beforeMonth).toISOString(), '2026-07-31T16:00:00.000Z');

  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  try {
    pool.query = async (sql, params) => {
      assert(sql.includes('LEFT JOIN crd_shop_purchases'));
      assert.equal(params[0], 'shop-user');
      return {
        rows: [
          { credux: 12_345_678, product_id: 2, period_key: periodKey('monthly'), qty: 5 },
          { credux: 12_345_678, product_id: 5, period_key: periodKey('daily'), qty: 4 },
          { credux: 12_345_678, product_id: 7, period_key: periodKey('weekly'), qty: 1 },
        ],
      };
    };
    const shopView = await buildShop('shop-user');
    const shopJson = JSON.stringify(shopView.components[0].toJSON());
    const categoryPositions = ['**Unlimited**', '**Monthly**', '**Daily**', '**Weekly**']
      .map((heading) => shopJson.indexOf(heading));
    assert(categoryPositions.every((position) => position >= 0));
    assert.deepEqual([...categoryPositions].sort((a, b) => a - b), categoryPositions);
    assert.equal((shopJson.match(/resets <t:/g) || []).length, 3);
    assert(!shopJson.includes('no limit'));
    assert(shopJson.includes('**5/10**'));
    assert(shopJson.includes('**4/10**'));
    assert(shopJson.includes('**1/1**'));
    for (const id of CRD_SHOP.map((item) => item.id)) {
      assert(shopJson.includes('`' + id + '`'), `shop view missing product ${id}`);
    }

    const state = { bag: { credux: 100_000, silver_chest: 0 }, tracking: new Map() };
    const fake = installFakePool(state);
    const valid = messageFor();
    await buy(valid.message, ['5', '2']);
    assert.equal(state.bag.credux, 90_000);
    assert.equal(state.bag.silver_chest, 2);
    assert.equal(state.tracking.get(`shop-user:5:${periodKey('daily')}`), 2);
    assert.match(valid.replies[0].content, /allowance: \*\*8\*\* left/);

    const connectsBeforeInvalid = fake.connects();
    for (const qty of ['0', '-1', '1.5', 'abc']) {
      const invalid = messageFor();
      await buy(invalid.message, ['5', qty]);
      assert.match(invalid.replies[0].content, /Invalid quantity/);
    }
    const unknown = messageFor();
    await buy(unknown.message, ['8', '1']);
    assert.match(unknown.replies[0].content, /Unknown product id/);
    assert.equal(fake.connects(), connectsBeforeInvalid);

    const insufficientState = { bag: { credux: 499_999, diamond_chest: 0 }, tracking: new Map() };
    installFakePool(insufficientState);
    const insufficient = messageFor();
    await buy(insufficient.message, ['7', '1']);
    assert.match(insufficient.replies[0].content, /Not enough Credux/);
    assert.equal(insufficientState.bag.credux, 499_999);
    assert.equal(insufficientState.bag.diamond_chest, 0);

    const cappedState = { bag: { credux: 100_000_000 }, tracking: new Map([
      [`shop-user:5:${periodKey('daily')}`, 9],
      [`shop-user:7:${periodKey('weekly')}`, 1],
      [`shop-user:2:${periodKey('monthly')}`, 10],
    ]) };
    installFakePool(cappedState);
    for (const [id, qty, period] of [['5', '2', 'daily'], ['7', '1', 'weekly'], ['2', '1', 'monthly']]) {
      const capped = messageFor();
      await buy(capped.message, [id, qty]);
      assert.match(capped.replies[0].content, new RegExp(`${period} limit`, 'i'));
    }
    assert.equal(cappedState.bag.credux, 100_000_000);

    const concurrentState = { bag: { credux: 20_000_000, diamond_chest: 0 }, tracking: new Map() };
    const concurrentPool = installFakePool(concurrentState);
    const first = messageFor();
    const second = messageFor();
    await Promise.all([buy(first.message, ['7', '1']), buy(second.message, ['7', '1'])]);
    assert.equal(concurrentState.bag.credux, 19_500_000);
    assert.equal(concurrentState.bag.diamond_chest, 1);
    assert.equal(concurrentState.tracking.get(`shop-user:7:${periodKey('weekly')}`), 1);
    assert.equal([first, second].filter((entry) => /Bought/.test(entry.replies[0].content)).length, 1);
    assert.equal(concurrentPool.isClean(), true);

    const rollbackState = { bag: { credux: 100_000, silver_chest: 0 }, tracking: new Map() };
    installFakePool(rollbackState, { failInventory: true });
    const rollback = messageFor();
    const originalError = console.error;
    console.error = () => {};
    try {
      await buy(rollback.message, ['5', '2']);
    } finally {
      console.error = originalError;
    }
    assert.equal(rollbackState.bag.credux, 100_000);
    assert.equal(rollbackState.bag.silver_chest, 0);
    assert.equal(rollbackState.tracking.size, 0);
    assert.match(rollback.replies[0].content, /nothing was spent/);
  } finally {
    pool.connect = originalConnect;
    pool.query = originalQuery;
  }

  console.log('CRD SHOP SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
