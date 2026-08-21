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
  const r2Source = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'r2Client.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
  const retentionEnvName = RETENTION_ENV_REGRESSION_KEY;

  assert.match(source, /const CANVAS_CACHE_MAX_AGE_DAYS = 1;/);
  assert.match(source, /const CANVAS_CACHE_RETENTION_GRACE_MS = 1000;/);
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

  assert.match(source, /last_used_at::text AS last_used_at_cursor/);
  assert.match(source, /WHERE last_used_at < \$1/);
  assert.match(source,
    /\(last_used_at, cache_key\) > \(\$2::timestamptz, \$3::text\)/);
  assert.match(source, /ORDER BY last_used_at ASC, cache_key ASC/);
  assert.match(source, /LIMIT \$4/);
  assert.doesNotMatch(source, /\bOFFSET\b/);
  assert.match(source, /DELETE FROM canvas_cache/);
  assert.match(source, /cache_key = ANY\(\$1::text\[\]\)/);
  assert.match(source, /RETURNING cache_key/);
  assert(source.indexOf('r2.deleteObject') < source.indexOf('DELETE FROM canvas_cache'),
    'R2 cleanup must be attempted before the expired database rows are deleted');
  assert.match(r2Source, /res\.ok \|\| res\.status === 404/,
    'the production R2 client must treat an already-missing object as successful cleanup');
  assert.match(source, /\[CanvasCache\] Sweep started/);
  assert.match(source, /\[CanvasCache\] Sweep complete/);
  for (const field of [
    'expiredConsidered',
    'dbRowsDeleted',
    'r2ObjectsDeleted',
    'r2CleanupFailures',
    'remainingExpiredRows',
    'durationMs',
  ]) {
    assert.match(source, new RegExp(`\\b${field}\\b`), `summary log is missing ${field}`);
  }
  assert.match(source, /Sweep skipped: another sweep is already running/);
  assert.match(indexSource, /const CANVAS_CACHE_SWEEP_INTERVAL_MS = 60 \* 60 \* 1000/);
  assert.match(indexSource,
    /client\.once\('ready', async \(\) => \{[\s\S]*runCanvasCacheSweep\(\)\s*\n\s*\.catch\(\(err\) => console\.error\('\[CanvasCache\] startup sweep failed:/);
  assert.equal((indexSource.match(/\[CanvasCache\] startup sweep failed/g) || []).length, 1,
    'readiness must initialize one startup cleanup');
  assert.match(indexSource,
    /canvasCacheSweepInterval = setInterval\(\(\) => \{\s*runCanvasCacheSweep\(\)[\s\S]*CANVAS_CACHE_SWEEP_INTERVAL_MS\);/);
}

async function main() {
  const {
    CANVAS_CACHE_MAX_AGE_DAYS,
    CANVAS_CACHE_RETENTION_MS,
    CANVAS_CACHE_RETENTION_GRACE_MS,
    CANVAS_CACHE_SWEEP_BATCH_SIZE,
    CANVAS_CACHE_SWEEP_BATCH_DELAY_MS,
    __test,
  } = canvasCache;

  assert.equal(CANVAS_CACHE_MAX_AGE_DAYS, 1);
  assert.equal(CANVAS_CACHE_RETENTION_GRACE_MS, 1000);
  assert.equal(CANVAS_CACHE_RETENTION_MS, (24 * 60 * 60 * 1000) + 1000);
  assert.equal(CANVAS_CACHE_SWEEP_BATCH_SIZE, 500);
  assert.equal(CANVAS_CACHE_SWEEP_BATCH_DELAY_MS, 250);
  assert.equal(process.env[RETENTION_ENV_REGRESSION_KEY], '365',
    'the negative regression fixture must differ from the hardcoded policy');

  const now = Date.now();
  assert.equal(__test.isCanvasCacheExpired(now - (24 * 60 * 60 * 1000), now), false,
    'an entry exactly one day old must be kept');
  assert.equal(__test.isCanvasCacheExpired(now - CANVAS_CACHE_RETENTION_MS, now), false,
    'the exact one-day-plus-one-second boundary must be kept');
  assert.equal(__test.isCanvasCacheExpired(now - CANVAS_CACHE_RETENTION_MS - 1, now), true,
    'an entry beyond one day plus one second must expire');
  assert.equal(__test.isMissingR2ObjectError({ status: 404 }), true);
  assert.equal(__test.isMissingR2ObjectError({ name: 'NoSuchKey' }), true);
  assert.equal(__test.isMissingR2ObjectError({ code: 'NotFound' }), true);
  assert.equal(__test.isMissingR2ObjectError(new Error('network unavailable')), false);
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

  const selectCalls = [];
  const dbDeleteCalls = [];
  const countCalls = [];
  const batchSelections = [];
  const operationEvents = [];
  const r2Attempts = [];
  const delays = [];
  const infoLogs = [];
  const warnLogs = [];
  const errorLogs = [];
  let failNextDbDelete = false;
  const cacheRows = new Map();
  const expiredAt = new Date(now - CANVAS_CACHE_RETENTION_MS - 60_000);

  for (let i = 0; i < 1200; i += 1) {
    const cacheKey = `expired-${String(i).padStart(4, '0')}`;
    cacheRows.set(cacheKey, {
      cache_key: cacheKey,
      object_key: `cache/canvas/${cacheKey}.webp`,
      last_used_at: expiredAt,
    });
  }
  cacheRows.get('expired-0050').object_key = 'cache/canvas/already-missing.webp';
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

  const persistentGameData = {
    profiles: [{ discord_id: 'persistent-user' }],
    inventories: [{ discord_id: 'persistent-user', credux: 123 }],
    economy: [{ discord_id: 'persistent-user', balance: 789 }],
    battleHistory: [{ discord_id: 'persistent-user', outcome: 'win' }],
    bossParticipation: [{ boss_spawn_id: 'persistent-spawn', total_damage: 456 }],
  };
  const persistentBefore = JSON.stringify(persistentGameData);

  const compareRows = (a, b) => {
    const timeDifference = a.last_used_at.getTime() - b.last_used_at.getTime();
    return timeDifference || a.cache_key.localeCompare(b.cache_key);
  };

  pool.query = async (sql, params = []) => {
    const normalized = String(sql).trim();
    if (normalized.startsWith('SELECT cache_key, object_key,')) {
      selectCalls.push({ sql: normalized, params });
      const cutoff = new Date(params[0]).getTime();
      const cursorTime = params[1] === null ? null : new Date(params[1]).getTime();
      const cursorKey = String(params[2] || '');
      const limit = Number(params[3]);
      const selected = [...cacheRows.values()]
        .filter((row) => row.last_used_at && row.last_used_at.getTime() < cutoff)
        .filter((row) => cursorTime === null
          || row.last_used_at.getTime() > cursorTime
          || (row.last_used_at.getTime() === cursorTime && row.cache_key > cursorKey))
        .sort(compareRows)
        .slice(0, limit);
      batchSelections.push(selected.map((row) => row.cache_key));
      operationEvents.push({ type: 'select', keys: selected.map((row) => row.cache_key) });
      return {
        rows: selected.map((row) => ({
          cache_key: row.cache_key,
          object_key: row.object_key,
          last_used_at_cursor: row.last_used_at.toISOString(),
        })),
        rowCount: selected.length,
      };
    }
    if (normalized.startsWith('DELETE FROM canvas_cache')) {
      dbDeleteCalls.push({ sql: normalized, params });
      if (failNextDbDelete) {
        failNextDbDelete = false;
        throw new Error('simulated batch database deletion failure');
      }
      const keys = new Set(params[0]);
      const cutoff = new Date(params[1]).getTime();
      const deleted = [];
      for (const [key, row] of cacheRows) {
        if (keys.has(key) && row.last_used_at && row.last_used_at.getTime() < cutoff) {
          cacheRows.delete(key);
          deleted.push({ cache_key: key });
        }
      }
      operationEvents.push({ type: 'database-delete', keys: deleted.map((row) => row.cache_key) });
      return { rows: deleted, rowCount: deleted.length };
    }
    if (normalized.startsWith('SELECT COUNT(*)::bigint AS remaining_expired_rows')) {
      countCalls.push({ sql: normalized, params });
      const cutoff = new Date(params[0]).getTime();
      const count = [...cacheRows.values()]
        .filter((row) => row.last_used_at && row.last_used_at.getTime() < cutoff).length;
      return { rows: [{ remaining_expired_rows: String(count) }], rowCount: 1 };
    }
    throw new Error(`cleanup touched an unexpected query: ${normalized}`);
  };

  r2.deleteObject = async (objectKey) => {
    operationEvents.push({ type: 'r2-delete', objectKey });
    r2Attempts.push(objectKey);
    const match = objectKey.match(/expired-(\d{4})/);
    if (match && Number(match[1]) < 25) {
      throw new Error('simulated R2 network failure');
    }
    if (match && Number(match[1]) < 50) return false;
    if (objectKey.endsWith('/already-missing.webp')) {
      const err = new Error('NoSuchKey: object is already absent');
      err.name = 'NoSuchKey';
      err.$metadata = { httpStatusCode: 404 };
      throw err;
    }
    return true;
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
    assert.equal(deleted, 1200, 'all expired database rows must be deleted in one sweep');
    assert.equal(selectCalls.length, 4, '500 + 500 + 200 must be followed by an empty cursor query');
    assert.equal(dbDeleteCalls.length, 3, 'each non-empty selection must receive one database delete');
    assert.equal(countCalls.length, 1, 'the sweep must validate its remaining expired count');
    assert.equal(selectCalls[0].params[3], 500);
    assert(selectCalls[0].params[0] instanceof Date, 'the retention cutoff must be parameterized');
    assert.equal(selectCalls[0].params[1], null, 'the first batch must start without a cursor');
    assert.deepEqual(batchSelections.map((batch) => batch.length), [500, 500, 200, 0]);
    assert.deepEqual(batchSelections[0].slice(0, 3),
      ['expired-0000', 'expired-0001', 'expired-0002']);
    assert.equal(batchSelections[0].at(-1), 'expired-0499');
    assert.equal(batchSelections[1][0], 'expired-0500');
    assert.equal(selectCalls[1].params[2], 'expired-0499',
      'the second batch must advance from the last processed cache key');
    assert.equal(typeof selectCalls[1].params[1], 'string',
      'the cursor must retain PostgreSQL timestamp text rather than a precision-losing Date');
    assert.equal(operationEvents.find((event) => event.type === 'database-delete').keys.length, 500,
      'all 500 first-batch database rows must be removed despite 50 R2 failures');

    assert.equal(r2Attempts.length, 1200, 'R2 cleanup must be attempted for every expired row');
    assert.equal(new Set(r2Attempts).size, 1200,
      'each expired object must be considered at most once in one sweep');
    assert.equal(cacheRows.has('fresh'), true, 'non-expired cache rows must remain');
    assert.equal(cacheRows.has('missing-last-used'), true,
      'a malformed row without last_used_at must be retained conservatively');
    for (let i = 0; i < 50; i += 1) {
      assert.equal(cacheRows.has(`expired-${String(i).padStart(4, '0')}`), false,
        'R2 network failures must not retain expired database rows');
    }
    assert.equal(cacheRows.has('expired-0050'), false,
      'an already-missing R2 object must not retain its database row');

    const firstDatabaseDelete = operationEvents.findIndex((event) => event.type === 'database-delete');
    const firstR2Delete = operationEvents.findIndex((event) => event.type === 'r2-delete');
    const secondSelection = operationEvents.findIndex((event, index) => (
      index > 0 && event.type === 'select'
    ));
    assert(firstR2Delete > 0 && firstR2Delete < firstDatabaseDelete,
      'R2 cleanup must happen after selection but before database deletion');
    assert(firstDatabaseDelete < secondSelection,
      'the first batch must finish before the stable cursor advances to the next batch');
    assert.equal(delays.filter((ms) => ms === 250).length, 2,
      'the fixed delay must run after both full batches');
    assert.equal(JSON.stringify(persistentGameData), persistentBefore,
      'persistent game data must never be touched');

    assert(infoLogs.some((line) => line.includes('[CanvasCache] Sweep started')));
    const completion = infoLogs.find((line) => line.includes('[CanvasCache] Sweep complete'));
    assert(completion?.includes('"expiredConsidered":1200'));
    assert(completion?.includes('"dbRowsDeleted":1200'));
    assert(completion?.includes('"r2ObjectsDeleted":1150'));
    assert(completion?.includes('"r2CleanupFailures":50'));
    assert(completion?.includes('"remainingExpiredRows":0'));
    assert.equal(warnLogs.filter((line) => line.includes('R2 cleanup failures in batch')).length, 1,
      'the 50 failures must be aggregated into one batch warning');
    assert.equal(warnLogs.some((line) => line.includes('already-missing.webp')), false,
      'an already-missing object is successful cleanup, not a warning');
    assert.equal(errorLogs.length, 0);

    // Even a failed database deletion cannot pin the cursor on the oldest
    // rows. The failed 500 are reported as remaining while the next 100 are
    // still processed, and none of the 600 objects is considered twice.
    const dbFailureTimestamp = new Date(Date.now() - CANVAS_CACHE_RETENTION_MS - 60_000);
    for (let i = 0; i < 600; i += 1) {
      const cacheKey = `db-failure-${String(i).padStart(4, '0')}`;
      cacheRows.set(cacheKey, {
        cache_key: cacheKey,
        object_key: `cache/canvas/${cacheKey}.webp`,
        last_used_at: dbFailureTimestamp,
      });
    }
    const attemptsBeforeDbFailureSweep = r2Attempts.length;
    failNextDbDelete = true;
    const deletedAfterBatchFailure = await canvasCache.sweepCanvasCache();
    const dbFailureAttempts = r2Attempts.slice(attemptsBeforeDbFailureSweep);
    assert.equal(deletedAfterBatchFailure, 100,
      'a failed first database batch must not prevent deletion of the next cursor batch');
    assert.equal(dbFailureAttempts.length, 600);
    assert.equal(new Set(dbFailureAttempts).size, 600,
      'a database failure must not make the same selected objects repeat in one sweep');
    assert.equal([...cacheRows.keys()].filter((key) => key.startsWith('db-failure-')).length, 500);
    assert(infoLogs.some((line) => line.includes('"remainingExpiredRows":500')),
      'the completion summary must expose rows left by a database deletion failure');
    assert(errorLogs.some((line) => line.includes('Expired-row database deletion failed')
      && line.includes('simulated batch database deletion failure')));
    for (const key of [...cacheRows.keys()]) {
      if (key.startsWith('db-failure-')) cacheRows.delete(key);
    }

    // The database sweep remains authoritative when R2 is not configured.
    for (const key of Object.keys(r2Env)) delete process.env[key];
    const withoutR2Key = 'expired-without-r2';
    cacheRows.set(withoutR2Key, {
      cache_key: withoutR2Key,
      object_key: 'cache/canvas/expired-without-r2.webp',
      last_used_at: new Date(Date.now() - CANVAS_CACHE_RETENTION_MS - 1),
    });
    const r2CallsBeforeDisabledSweep = r2Attempts.length;
    const deletedWithoutR2 = await canvasCache.sweepCanvasCache();
    assert.equal(deletedWithoutR2, 1);
    assert.equal(cacheRows.has(withoutR2Key), false);
    assert.equal(r2Attempts.length, r2CallsBeforeDisabledSweep,
      'R2 deletion must be skipped cleanly when credentials are unavailable');
    Object.assign(process.env, r2Env);

    // Hold selection open so a simultaneous trigger hits the one-sweeper guard.
    let releaseSelection;
    pool.query = async (sql) => {
      const normalized = String(sql).trim();
      if (normalized.startsWith('SELECT cache_key, object_key,')) {
        return new Promise((resolve) => { releaseSelection = resolve; });
      }
      if (normalized.startsWith('SELECT COUNT(*)::bigint AS remaining_expired_rows')) {
        return { rows: [{ remaining_expired_rows: '0' }], rowCount: 1 };
      }
      throw new Error(`unexpected overlap query: ${normalized}`);
    };
    const first = canvasCache.sweepCanvasCache();
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    const second = await canvasCache.sweepCanvasCache();
    assert.equal(second, 0, 'an overlapping sweep must be skipped');
    releaseSelection({ rows: [], rowCount: 0 });
    await first;

    // Selection failures are logged and the guard is always released.
    pool.query = async (sql) => {
      const normalized = String(sql).trim();
      if (normalized.startsWith('SELECT COUNT(*)::bigint AS remaining_expired_rows')) {
        return { rows: [{ remaining_expired_rows: '0' }], rowCount: 1 };
      }
      throw new Error('simulated cleanup selection failure');
    };
    const failedDeleted = await canvasCache.sweepCanvasCache();
    assert.equal(failedDeleted, 0);
    assert(errorLogs.some((line) => line.includes('Expired-row selection failed')
      && line.includes('simulated cleanup selection failure')),
    'database selection failures must be logged rather than ignored');
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

  console.log('[canvas-sweeper] R2-first cleanup, cursor batching, retention, summary, and overlap checks passed.');
}

main().catch((err) => {
  console.error('[canvas-sweeper] FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
