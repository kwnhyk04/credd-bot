'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RETENTION_ENV_REGRESSION_KEY = ['CANVAS', 'CACHE', 'MAX', 'AGE', 'DAYS'].join('_');
const previousRetentionEnv = process.env[RETENTION_ENV_REGRESSION_KEY];

// Exercise the real sweeper with only Postgres and R2 calls stubbed.
process.env.ASSET_BASE_URL = 'https://assets.example.test';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_BUCKET = 'test-bucket';
process.env.RESOURCE_LOGS = 'false';
process.env.PERFORMANCE_LOGS = 'false';
process.env.BANDWIDTH_LOGS = 'false';
// An obsolete deployment value must not affect the hardcoded code policy.
process.env[RETENTION_ENV_REGRESSION_KEY] = '365';

const ROOT = path.join(__dirname, '..');
const pool = require('../src/db/pool');
const r2 = require('../src/utils/r2Client');
const canvasCache = require('../src/utils/canvasCache');

function sourceContracts() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'canvasCache.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
  const retentionEnvName = RETENTION_ENV_REGRESSION_KEY;

  assert.match(source, /const CANVAS_CACHE_MAX_AGE_DAYS = 1;/);
  assert.equal((source.match(/const CANVAS_CACHE_MAX_AGE_DAYS = 1;/g) || []).length, 1,
    'the one-day retention policy must have one code declaration');
  assert.equal(source.includes(`envNumber('${retentionEnvName}'`), false,
    'cache retention must not be loaded through envNumber');
  assert.equal(source.includes(`process.env.${retentionEnvName}`), false,
    'cache retention must not read process.env');
  for (const [name, config] of [
    ['.env.example', envExample],
    ['Dockerfile', dockerfile],
    ['deploy workflow', workflow],
  ]) {
    assert.equal(config.includes(retentionEnvName), false,
      `${name} must not advertise or inject a cache-retention environment variable`);
  }
  assert.match(source, /WITH expired AS/);
  assert.match(source, /WHERE last_used_at < \$1/);
  assert.match(source, /ORDER BY last_used_at ASC/);
  assert.match(source, /LIMIT \$2/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /DELETE FROM canvas_cache cache/);
  assert.match(source, /RETURNING cache\.cache_key, cache\.object_key/);
  assert.doesNotMatch(source, /async function sweepCanvasCache\(\) \{\s*if \(!enabled\(\)\) return 0/);
  assert.match(source, /\[CACHE CLEANUP\] Starting canvas_cache cleanup/);
  assert.match(source, /\[CACHE CLEANUP\] canvas_cache database cleanup failed/);
  assert.match(source, /R2 cleanup failed after Supabase row deletion/);
  assert.match(indexSource, /const CANVAS_CACHE_SWEEP_INTERVAL_MS = 60 \* 60 \* 1000/);
  assert.match(indexSource, /client\.once\('ready', async \(\) => \{[\s\S]*runCanvasCacheSweep\(\)\s*\n\s*\.catch\(\(err\) => console\.error\('\[CanvasCache\] startup sweep failed:/);
  assert.equal((indexSource.match(/\[CanvasCache\] startup sweep failed/g) || []).length, 1,
    'readiness must initialize one startup cleanup');
  assert.match(indexSource,
    /canvasCacheSweepInterval = setInterval\(\(\) => \{\s*runCanvasCacheSweep\(\)[\s\S]*CANVAS_CACHE_SWEEP_INTERVAL_MS\);/);
}

async function main() {
  const {
    CANVAS_CACHE_MAX_AGE_DAYS,
    CANVAS_CACHE_RETENTION_MS,
    CANVAS_CACHE_SWEEP_BATCH_SIZE,
    CANVAS_CACHE_SWEEP_BATCH_DELAY_MS,
    __test,
  } = canvasCache;

  assert.equal(CANVAS_CACHE_MAX_AGE_DAYS, 1);
  assert.equal(process.env[RETENTION_ENV_REGRESSION_KEY], '365',
    'the negative regression fixture must differ from the hardcoded policy');
  assert.equal(CANVAS_CACHE_RETENTION_MS, 24 * 60 * 60 * 1000);
  assert.equal(CANVAS_CACHE_SWEEP_BATCH_SIZE, 500);
  assert.equal(CANVAS_CACHE_SWEEP_BATCH_DELAY_MS, 250);
  const now = Date.now();
  assert.equal(__test.isCanvasCacheExpired(now - (23 * 60 * 60 * 1000), now), false,
    '23-hour-old entries must be kept');
  assert.equal(__test.isCanvasCacheExpired(now - CANVAS_CACHE_RETENTION_MS, now), false,
    'the exact retention boundary must be kept');
  assert.equal(__test.isCanvasCacheExpired(now - CANVAS_CACHE_RETENTION_MS - 1, now), true,
    'entries older than the retention boundary must expire');
  sourceContracts();

  const realQuery = pool.query;
  const realDeleteObject = r2.deleteObject;
  const realSetTimeout = global.setTimeout;
  const realConsoleInfo = console.info;
  const realConsoleWarn = console.warn;
  const realConsoleError = console.error;
  const r2Env = {
    ASSET_BASE_URL: process.env.ASSET_BASE_URL,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
  };
  const deleteCalls = [];
  const batchSelections = [];
  const operationEvents = [];
  const deletedObjects = [];
  const delays = [];
  const infoLogs = [];
  const warnLogs = [];
  const errorLogs = [];
  let r2SawExistingDatabaseRow = false;
  const persistentGameData = {
    profiles: [{ discord_id: 'persistent-user' }],
    inventories: [{ discord_id: 'persistent-user', credux: 123 }],
    economy: [{ discord_id: 'persistent-user', balance: 789 }],
    gameLogs: [{ discord_id: 'persistent-user', outcome: 'win' }],
    raidLogs: [{ discord_id: 'persistent-user', damage: 123 }],
    bossAttackLog: [{ boss_spawn_id: 'persistent-spawn', total_damage: 456 }],
    progression: [{ discord_id: 'persistent-user', level: 99 }],
  };
  const persistentBefore = JSON.stringify(persistentGameData);
  const cacheRows = new Map();
  for (let i = 0; i < 1002; i += 1) {
    cacheRows.set(`expired-${i}`, {
      cache_key: `expired-${i}`,
      object_key: `cache/canvas/expired-${i}.webp`,
      last_used_at: new Date(now - CANVAS_CACHE_RETENTION_MS - 60_000 - i),
    });
  }
  cacheRows.get('expired-1000').object_key = 'cache/canvas/r2-failure.webp';
  cacheRows.set('fresh', {
    cache_key: 'fresh',
    object_key: 'cache/canvas/fresh.webp',
    last_used_at: new Date(now - 60_000),
  });
  cacheRows.set('missing-last-used', {
    cache_key: 'missing-last-used',
    object_key: 'cache/canvas/missing-last-used.webp',
    last_used_at: null,
  });

  pool.query = async (sql, params = []) => {
    const normalized = String(sql).trim();
    if (!normalized.startsWith('WITH expired AS')) {
      throw new Error(`cleanup touched a non-cache query: ${normalized}`);
    }
    deleteCalls.push({ sql: normalized, params });
    const cutoff = new Date(params[0]).getTime();
    const limit = Number(params[1]);
    const expired = [...cacheRows.values()]
      .filter((row) => row.last_used_at && row.last_used_at.getTime() < cutoff)
      .sort((a, b) => a.last_used_at - b.last_used_at)
      .slice(0, limit);
    for (const row of expired) cacheRows.delete(row.cache_key);
    batchSelections.push(expired.map((row) => row.cache_key));
    operationEvents.push({ type: 'database-delete', keys: expired.map((row) => row.cache_key) });
    return {
      rows: expired.map(({ cache_key, object_key }) => ({ cache_key, object_key })),
      rowCount: expired.length,
    };
  };
  r2.deleteObject = async (objectKey) => {
    if ([...cacheRows.values()].some((row) => row.object_key === objectKey)) {
      r2SawExistingDatabaseRow = true;
    }
    operationEvents.push({ type: 'r2-delete', objectKey });
    deletedObjects.push(objectKey);
    return objectKey !== 'cache/canvas/r2-failure.webp';
  };
  global.setTimeout = (callback, ms, ...args) => {
    delays.push(ms);
    return realSetTimeout(callback, 0, ...args);
  };
  const formatLog = (args) => args.map((value) => (
    typeof value === 'string' ? value : JSON.stringify(value)
  )).join(' ');
  console.info = (...args) => infoLogs.push(formatLog(args));
  console.warn = (...args) => warnLogs.push(formatLog(args));
  console.error = (...args) => errorLogs.push(formatLog(args));

  try {
    const deleted = await canvasCache.sweepCanvasCache();
    assert.equal(deleted, 1002, 'every expired database row must be removed across all batches');
    assert.equal(deleteCalls.length, 4, 'the sweep must continue until an empty batch is returned');
    assert.equal(deleteCalls[0].params[1], 500);
    assert(deleteCalls[0].params[0] instanceof Date, 'the retention cutoff must be parameterized');
    assert.deepEqual(batchSelections[0].slice(0, 3),
      ['expired-1001', 'expired-1000', 'expired-999'],
      'the oldest cache rows must be selected first');
    assert.equal(batchSelections[0].at(-1), 'expired-502');
    assert.equal(batchSelections[1][0], 'expired-501');
    assert.deepEqual(batchSelections[2], ['expired-1', 'expired-0']);
    assert.equal(cacheRows.has('fresh'), true, 'non-expired cache rows must remain');
    assert.equal(cacheRows.has('missing-last-used'), true,
      'a malformed row without last_used_at must be retained conservatively');
    assert.equal(cacheRows.has('expired-1000'), false,
      'an R2 failure must not retain expired Supabase data');
    assert.equal(operationEvents[0].type, 'database-delete',
      'the Supabase delete must complete before any R2 cleanup begins');
    assert.equal(r2SawExistingDatabaseRow, false,
      'every Supabase row must already be gone when its R2 delete is attempted');
    assert.equal(deletedObjects.length, 1002, 'R2 cleanup must be attempted for every deleted row');
    assert(deletedObjects.indexOf('cache/canvas/r2-failure.webp') < deletedObjects.length - 1,
      'an R2 failure must not stop later object cleanup attempts');
    assert.equal(delays.filter((ms) => ms === 250).length, 2,
      'the fixed delay must occur after each full batch');
    assert.equal(JSON.stringify(persistentGameData), persistentBefore,
      'persistent game tables must never be touched');
    assert(infoLogs.some((line) => line.includes('[CACHE CLEANUP] Starting canvas_cache cleanup')));
    assert(infoLogs.some((line) => line.includes('[CACHE CLEANUP] cutoff=')));
    assert(infoLogs.some((line) => line.includes('[CACHE CLEANUP] batch=1 deleted=500')));
    assert(infoLogs.some((line) => line.includes('[CACHE CLEANUP] database_deleted=1002')));
    assert(infoLogs.some((line) => line.includes('[CACHE CLEANUP] r2_deleted=1001')));
    assert(infoLogs.some((line) => line.includes('[CACHE CLEANUP] r2_failed=1')));
    assert(infoLogs.some((line) => line.includes('[CACHE CLEANUP] Completed canvas_cache cleanup')));
    assert(warnLogs.some((line) => line.includes('[CACHE CLEANUP] R2 cleanup failed')
      && line.includes('cache/canvas/r2-failure.webp')),
    'R2 failures must be logged independently from database failures');

    // Stale database rows must still be removed when R2 credentials are
    // unavailable; object-store cleanup is independent best effort.
    for (const key of Object.keys(r2Env)) delete process.env[key];
    cacheRows.set('expired-without-r2', {
      cache_key: 'expired-without-r2',
      object_key: 'cache/canvas/expired-without-r2.webp',
      last_used_at: new Date(now - CANVAS_CACHE_RETENTION_MS - 1),
    });
    const r2CallsBeforeDisabledSweep = deletedObjects.length;
    const deletedWithoutR2 = await canvasCache.sweepCanvasCache();
    assert.equal(deletedWithoutR2, 1,
      'database cleanup must run even when R2 is not configured');
    assert.equal(cacheRows.has('expired-without-r2'), false);
    assert.equal(deletedObjects.length, r2CallsBeforeDisabledSweep,
      'R2 deletion is skipped cleanly when credentials are unavailable');
    Object.assign(process.env, r2Env);

    // Hold the first query open so the second invocation encounters the guard.
    let release;
    pool.query = async (sql) => {
      assert(String(sql).trim().startsWith('WITH expired AS'));
      return new Promise((resolve) => { release = resolve; });
    };
    const first = canvasCache.sweepCanvasCache();
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    const second = await canvasCache.sweepCanvasCache();
    assert.equal(second, 0, 'an overlapping sweep must be skipped');
    release({ rows: [] });
    await first;

    // Database failures are reported and end only the current pass.
    pool.query = async () => { throw new Error('simulated cleanup query failure'); };
    const failedDeleted = await canvasCache.sweepCanvasCache();
    assert.equal(failedDeleted, 0);
    assert(errorLogs.some((line) => line.includes('canvas_cache database cleanup failed')
      && line.includes('simulated cleanup query failure')),
    'cleanup query failures must be logged instead of ignored');
  } finally {
    Object.assign(process.env, r2Env);
    if (previousRetentionEnv === undefined) delete process.env[RETENTION_ENV_REGRESSION_KEY];
    else process.env[RETENTION_ENV_REGRESSION_KEY] = previousRetentionEnv;
    console.info = realConsoleInfo;
    console.warn = realConsoleWarn;
    console.error = realConsoleError;
    global.setTimeout = realSetTimeout;
    r2.deleteObject = realDeleteObject;
    pool.query = realQuery;
  }

  console.log('[canvas-sweeper] TTL, batching, safety, failure logging, and overlap checks passed.');
}

main().catch((err) => {
  console.error('[canvas-sweeper] FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
