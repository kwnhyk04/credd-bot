'use strict';

/**
 * lifecycle-guard-selftest — regression checks for the 2026-07-17 memory
 * follow-up:
 *   1. canvasCache lastTouched stays bounded (stale prune + hard cap).
 *   2. Every scheduler start/stop pair is restart-safe and idempotent.
 *   3. Casino stateful wraps do not retain full Discord Message objects.
 *
 * No database, Discord, or R2 access: pool.query is stubbed for the duration.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.RESOURCE_LOGS = 'false';
process.env.PERFORMANCE_LOGS = 'false';
process.env.BANDWIDTH_LOGS = 'false';

const pool = require('../src/db/pool');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const realQuery = pool.query.bind(pool);
  pool.query = async () => ({ rows: [], rowCount: 0 });

  try {
    // ---------------------------------------------------------------- 1
    console.log('[lifecycle] canvasCache lastTouched bound');
    const { __test } = require('../src/utils/canvasCache');
    const { touch, lastTouched, MEMORY_MAX } = __test;

    process.env.CANVAS_CACHE_TOUCH_THROTTLE_MS = '300000';
    lastTouched.clear();
    for (let i = 0; i < MEMORY_MAX + 500; i += 1) touch(`cap-key-${i}`);
    check(`hard cap holds (${lastTouched.size} <= ${MEMORY_MAX}) with all-fresh entries`, () => {
      assert(lastTouched.size <= MEMORY_MAX,
        `lastTouched.size ${lastTouched.size} exceeds MEMORY_MAX ${MEMORY_MAX}`);
    });

    lastTouched.clear();
    const staleTs = Date.now() - 10_000;
    for (let i = 0; i <= MEMORY_MAX; i += 1) lastTouched.set(`stale-key-${i}`, staleTs);
    process.env.CANVAS_CACHE_TOUCH_THROTTLE_MS = '50';
    touch('fresh-key-1');
    check('stale prune removes expired timestamps before hard cap', () => {
      assert.strictEqual(lastTouched.size, 1,
        `expected only the fresh key to remain, got ${lastTouched.size}`);
      assert(lastTouched.has('fresh-key-1'), 'fresh key must survive the prune');
    });

    check('throttle behavior preserved for fresh keys', () => {
      const before = lastTouched.get('fresh-key-1');
      touch('fresh-key-1'); // within 50ms throttle -> suppressed, timestamp unchanged
      assert.strictEqual(lastTouched.get('fresh-key-1'), before,
        'throttled touch must not rewrite the timestamp');
    });
    lastTouched.clear();
    delete process.env.CANVAS_CACHE_TOUCH_THROTTLE_MS;

    // ---------------------------------------------------------------- 2
    console.log('[lifecycle] scheduler restart-safe guards');
    const fakeClient = { guilds: { cache: new Map() } };
    const schedulers = [
      ['battleReaper', async () => require('../src/schedulers/battleReaper').startBattleReaper()],
      ['bossScheduler', async () => require('../src/schedulers/bossScheduler').startBossScheduler(fakeClient)],
      ['resetScheduler', async () => require('../src/schedulers/resetScheduler').startResetScheduler()],
      ['seasonScheduler', async () => require('../src/schedulers/seasonScheduler').startSeasonScheduler()],
    ];
    for (const [name, start] of schedulers) {
      const stop1 = await start();
      const stop2 = await start();
      check(`${name}: double start returns the same stop function`, () => {
        assert.strictEqual(typeof stop1, 'function', 'start must return a stop function');
        assert.strictEqual(stop1, stop2, 'second start must return the identical stop function');
      });
      check(`${name}: stop is safe to call repeatedly`, () => {
        stop1();
        stop1();
        stop2();
      });
      const stop3 = await start();
      check(`${name}: start after stop creates a fresh scheduler`, () => {
        assert.strictEqual(typeof stop3, 'function');
        assert.notStrictEqual(stop3, stop1, 'restart must produce a new stop function');
      });
      stop3();
    }

    // ---------------------------------------------------------------- 3
    console.log('[lifecycle] casino wraps hold ids, not Message objects');
    for (const file of ['blackjack.js', 'crash.js']) {
      const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'casino', file), 'utf8');
      check(`${file}: no wrap.message retention`, () => {
        assert(!/wrap\.message\b(?!Id)/.test(source),
          `${file} still references wrap.message (full Message retention)`);
        assert(/wrap\.messageId/.test(source), `${file} must track messageId`);
        assert(/\.messages\.edit\(/.test(source),
          `${file} must edit via channel.messages.edit (same REST route)`);
      });
    }
  } finally {
    pool.query = realQuery;
  }

  console.log(`[lifecycle] ${passed} checks passed.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[lifecycle] FAILED:', err.message);
  process.exit(1);
});
