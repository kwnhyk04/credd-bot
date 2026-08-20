'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Exercise the real sweeper with only Postgres and R2 calls stubbed.
process.env.ASSET_BASE_URL = 'https://assets.example.test';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_BUCKET = 'test-bucket';
process.env.RESOURCE_LOGS = 'false';
process.env.PERFORMANCE_LOGS = 'false';
process.env.BANDWIDTH_LOGS = 'false';

const ROOT = path.join(__dirname, '..');
const pool = require('../src/db/pool');
const r2 = require('../src/utils/r2Client');
const canvasCache = require('../src/utils/canvasCache');

function sourceContracts() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'canvasCache.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(source, /const CANVAS_CACHE_RETENTION_MS = \(24 \* 60 \* 60 \* 1000\) \+ 1000/);
  assert.match(source, /INTERVAL '1 day 1 second'/);
  assert.match(source, /ORDER BY last_used_at ASC/);
  assert.match(source, /LIMIT \$2/);
  assert.doesNotMatch(source, /CANVAS_CACHE_MAX_AGE_DAYS/);
  assert.match(indexSource, /const CANVAS_CACHE_SWEEP_INTERVAL_MS = 60 \* 60 \* 1000/);
  assert.match(indexSource, /runCanvasCacheSweep\(\)\s*\n\s*\.catch\(\(err\) => console\.error\('\[CanvasCache\] startup sweep failed:/);
}

async function main() {
  const {
    CANVAS_CACHE_RETENTION_MS,
    CANVAS_CACHE_SWEEP_BATCH_SIZE,
    CANVAS_CACHE_SWEEP_BATCH_DELAY_MS,
    __test,
  } = canvasCache;

  assert.equal(CANVAS_CACHE_RETENTION_MS, (24 * 60 * 60 * 1000) + 1000);
  assert.equal(CANVAS_CACHE_SWEEP_BATCH_SIZE, 500);
  assert.equal(CANVAS_CACHE_SWEEP_BATCH_DELAY_MS, 250);
  const now = Date.now();
  assert.equal(__test.isCanvasCacheExpired(now - (23 * 60 * 60 * 1000), now), false,
    '23-hour-old entries must be kept');
  assert.equal(__test.isCanvasCacheExpired(now - (24 * 60 * 60 * 1000), now), false,
    '24-hour-old entries must be kept');
  assert.equal(__test.isCanvasCacheExpired(now - CANVAS_CACHE_RETENTION_MS, now), false,
    'the exact 1-day-plus-1-second boundary must be kept');
  assert.equal(__test.isCanvasCacheExpired(now - CANVAS_CACHE_RETENTION_MS - 1, now), true,
    'entries older than the boundary must expire');
  sourceContracts();

  const realQuery = pool.query.bind(pool);
  const realDeleteObject = r2.deleteObject;
  const realSetTimeout = global.setTimeout;
  const selectCalls = [];
  const deletedRows = [];
  const deletedObjects = [];
  const delays = [];
  const batches = [
    Array.from({ length: 500 }, (_, i) => ({
      cache_key: `bulk-${i}`,
      object_key: `cache/canvas/bulk-${i}.webp`,
    })),
    Array.from({ length: 500 }, (_, i) => ({
      cache_key: `bulk-${i + 500}`,
      object_key: `cache/canvas/bulk-${i + 500}.webp`,
    })),
    [
      { cache_key: 'r2-failure', object_key: 'cache/canvas/r2-failure.webp' },
      { cache_key: 'last-good', object_key: 'cache/canvas/last-good.webp' },
    ],
    [],
  ];
  let selectIndex = 0;

  pool.query = async (sql, params = []) => {
    if (/^SELECT cache_key, object_key FROM canvas_cache/.test(sql.trim())) {
      selectCalls.push({ sql, params });
      return { rows: batches[selectIndex++] || [] };
    }
    if (/^DELETE FROM canvas_cache/.test(sql.trim())) {
      deletedRows.push(params[0]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected query in selftest: ${sql}`);
  };
  r2.deleteObject = async (objectKey) => {
    deletedObjects.push(objectKey);
    return objectKey !== 'cache/canvas/r2-failure.webp';
  };
  global.setTimeout = (callback, ms, ...args) => {
    delays.push(ms);
    return realSetTimeout(callback, 0, ...args);
  };

  try {
    const deleted = await canvasCache.sweepCanvasCache();
    assert.equal(deleted, 1001, 'all successful rows across every batch must be removed');
    assert.equal(selectCalls.length, 4, 'the sweep must continue until no rows remain');
    assert.equal(selectCalls[0].params[1], 500);
    assert.deepEqual(selectCalls[0].params[0], []);
    assert(selectCalls.some((call) => call.params[0].includes('r2-failure')),
      'a failed R2 key must be skipped in later queries during this pass');
    assert.equal(deletedRows.includes('r2-failure'), false,
      'an R2 failure must keep its database row');
    assert.equal(deletedRows.length, 1001);
    assert.equal(deletedObjects.length, 1002);
    assert.equal(delays.filter((ms) => ms === 250).length, 2,
      'the fixed delay must occur between the three non-final batches');
    assert.match(selectCalls[0].sql, /last_used_at < NOW\(\) - INTERVAL '1 day 1 second'/);
    assert.match(selectCalls[0].sql, /ORDER BY last_used_at ASC/);

    // Hold the first query open so the second invocation encounters the guard.
    let release;
    pool.query = async (sql) => {
      if (/^SELECT cache_key, object_key FROM canvas_cache/.test(sql.trim())) {
        return new Promise((resolve) => { release = resolve; });
      }
      return { rows: [] };
    };
    const first = canvasCache.sweepCanvasCache();
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    const second = await canvasCache.sweepCanvasCache();
    assert.equal(second, 0, 'an overlapping sweep must be skipped');
    release({ rows: [] });
    await first;
  } finally {
    global.setTimeout = realSetTimeout;
    r2.deleteObject = realDeleteObject;
    pool.query = realQuery;
  }

  console.log('[canvas-sweeper] fixed retention, batching, failure isolation, and overlap checks passed.');
}

main().catch((err) => {
  console.error('[canvas-sweeper] FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
