'use strict';

/**
 * canvasCache.js — render-once cache for deterministic per-user canvases
 * (profile/stats cards, equipment cards, quest boards).
 *
 * Key insight: these images are pure functions of their input data. We hash the
 * exact render inputs; same state → same key → the image is rendered + uploaded
 * to R2 exactly once and every later view references the public URL (zero bot
 * egress). Any state change produces a NEW key, so stale images are impossible
 * by construction — no explicit invalidation needed.
 *
 * Layers: in-memory Map → canvas_cache table (Supabase) → render + R2 PUT.
 * Every failure path returns null and the caller keeps today's attach behavior,
 * so this module can never break a command.
 *
 * Object layout: cache/canvas/<sha256[0..39]>.<webp|jpg|png> in the ASSET_BASE_URL
 * bucket. The stored URL is the public asset URL for that key. Rows carry
 * last_used_at so sweepCanvasCache() can evict cold objects (R2 stays tidy;
 * NOTE: an evicted URL in an old Discord message may eventually stop rendering
 * — acceptable for weeks-old ephemeral views, mirrors Discord's own expiry).
 *
 * Callers MUST include a render-revision number in `parts` and bump it when the
 * renderer's visuals change; ASSET_VERSION is mixed in automatically for art
 * swaps. First upload still costs one egress transfer (to Cloudflare) — savings
 * come from every repeat view, which transfers nothing.
 */

const crypto = require('crypto');
const pool = require('../db/pool');
const r2 = require('./r2Client');
const { getAssetUrl, isRemoteAssetsEnabled, assetVersion } = require('./assets');
const { optimizeOpaqueAttachment, extensionFromName, imageContentType } = require('./imageOutput');
const { bandwidthLog, envNumber, performanceLog } = require('./runtimeLogs');
const { withImageWorkSlot } = require('./imageWorkQueue');
const { registerMemorySource } = require('./memoryRegistry');
const { recordCanvasCache } = require('./networkTelemetry');

const MEMORY_MAX = 5000;
const MEMORY_MAX_BYTES = Math.max(1024 * 1024, envNumber('CANVAS_MEMORY_CACHE_MAX_MB', 8, { min: 1, max: 2048 }) * 1024 * 1024);
// One authoritative retention policy for Supabase canvas-cache rows. This is
// deliberately not environment-configurable, so every deployment cleans the
// database it is already connected to using the same conservative idle TTL.
const CANVAS_CACHE_MAX_AGE_DAYS = 1;
const CANVAS_CACHE_RETENTION_MS = CANVAS_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const CANVAS_CACHE_SWEEP_BATCH_SIZE = 500;
const CANVAS_CACHE_SWEEP_BATCH_DELAY_MS = 250;
const memory = new Map(); // cacheKey → url (insertion-ordered; trimmed FIFO)
const inflight = new Map(); // cacheKey → Promise<{url}|null>
const lastTouched = new Map(); // cacheKey -> ms timestamp of last last_used_at write
let memoryBytes = 0;
let warnedDb = false;
let sweepRunning = false;
const cacheStats = {
  memoryHits: 0,
  dbHits: 0,
  inflightHits: 0,
  misses: 0,
  uploadFailures: 0,
  uploadedBytes: 0,
};

function enabled() {
  return isRemoteAssetsEnabled() && r2.isConfigured();
}

function hashParts(parts) {
  const payload = JSON.stringify([assetVersion(), parts]);
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 40);
}

function estimateUrlBytes(url) {
  return Math.max(1, String(url || '').length * 2 + 128);
}

function forgetMemory(key) {
  // Touch timestamps exist for keys that were never (or are no longer) in
  // `memory` — DB hits also touch — so clear them unconditionally.
  lastTouched.delete(key);
  const entry = memory.get(key);
  if (!entry) return;
  memory.delete(key);
  memoryBytes = Math.max(0, memoryBytes - (typeof entry === 'string' ? estimateUrlBytes(entry) : entry.bytes));
}

function remember(key, url) {
  forgetMemory(key);
  const entry = { url, bytes: estimateUrlBytes(url) };
  memory.set(key, entry);
  memoryBytes += entry.bytes;
  while (memory.size > MEMORY_MAX || memoryBytes > MEMORY_MAX_BYTES) {
    const evicted = memory.keys().next().value;
    forgetMemory(evicted);
  }
}

function touchThrottleMs() {
  return Math.floor(envNumber('CANVAS_CACHE_TOUCH_THROTTLE_MS', 300_000, { min: 0, max: 86_400_000 }));
}

function pruneLastTouched(now, throttleMs) {
  if (lastTouched.size <= MEMORY_MAX) return;
  // Stale prune: a timestamp past the throttle window no longer suppresses
  // anything, so removing it is semantically identical to keeping it.
  for (const [staleKey, ts] of lastTouched) {
    if (throttleMs <= 0 || now - ts >= throttleMs) lastTouched.delete(staleKey);
  }
  // Hard cap: evict oldest entries until within bound. Insertion order equals
  // timestamp order (touch() re-inserts on write). Evicting a fresh entry only
  // permits one extra last_used_at DB touch for that key; the canvas `memory`
  // cache is never modified here.
  while (lastTouched.size > MEMORY_MAX) {
    lastTouched.delete(lastTouched.keys().next().value);
  }
}

function touch(key, logContext = {}) {
  const now = Date.now();
  const throttleMs = touchThrottleMs();
  const last = lastTouched.get(key) || 0;
  if (throttleMs > 0 && now - last < throttleMs) {
    performanceLog('canvas cache touch throttled', {
      ...logContext,
      cache: 'canvas',
      name: key.slice(0, 12),
      throttleMs,
    });
    return;
  }
  // Delete-then-set keeps Map insertion order aligned with timestamp order,
  // which pruneLastTouched relies on for oldest-first eviction.
  lastTouched.delete(key);
  lastTouched.set(key, now);
  pruneLastTouched(now, throttleMs);
  pool.query('UPDATE canvas_cache SET last_used_at = NOW() WHERE cache_key = $1', [key])
    .catch(() => {});
}

function dbWarn(err) {
  if (warnedDb) return;
  warnedDb = true;
  console.warn('[canvasCache] disabled this boot (DB):', err.message,
    '— apply scripts/canvas-cache-schema.sql');
}

/**
 * Resolve (or create) the cached public URL for a deterministic canvas.
 * @param {Array|Object} parts    exact render inputs + a render revision number
 * @param {Function} renderPng    async () => PNG Buffer — called only on a miss
 * @param {object} imageOptions   optimizeOpaqueAttachment options
 * @returns {Promise<{url:string}|null>}  null → caller must attach as before
 */
async function getCachedCanvasUrl(parts, renderPng, imageOptions = {}, cacheOptions = {}) {
  if (!enabled()) return null;
  const key = hashParts(parts);
  const returnImageOnFailure = cacheOptions.returnImageOnFailure === true;
  const logContext = cacheOptions.logContext || {};

  const cachedEntry = memory.get(key);
  if (cachedEntry) {
    cacheStats.memoryHits += 1;
    recordCanvasCache(logContext, 'memory');
    memory.delete(key);
    memory.set(key, cachedEntry);
    touch(key, logContext);
    performanceLog('canvas cache hit', { ...logContext, cache: 'memory-hit', name: key.slice(0, 12) });
    return { url: typeof cachedEntry === 'string' ? cachedEntry : cachedEntry.url, cache: 'memory-hit' };
  }
  if (inflight.has(key)) {
    cacheStats.inflightHits += 1;
    recordCanvasCache(logContext, 'coalesced');
    return inflight.get(key);
  }

  const job = (async () => {
    try {
      const { rows } = await pool.query(
        'SELECT url FROM canvas_cache WHERE cache_key = $1', [key]
      );
      if (rows.length > 0) {
        cacheStats.dbHits += 1;
        recordCanvasCache(logContext, 'database');
        remember(key, rows[0].url);
        touch(key, logContext);
        performanceLog('canvas cache hit', { ...logContext, cache: 'db-hit', name: key.slice(0, 12) });
        return { url: rows[0].url, cache: 'db-hit' };
      }
    } catch (err) {
      dbWarn(err);
      return null;
    }

    cacheStats.misses += 1;
    recordCanvasCache(logContext, 'miss');
    let image = null;
    try {
      image = await withImageWorkSlot(logContext.imageType || 'canvas', async () => {
        const png = await renderPng();
        // Same encoder as the attach path → byte-identical visuals either way.
        return optimizeOpaqueAttachment(png, 'canvas', {
          ...imageOptions,
          skipQueue: true,
          logContext,
        });
      }, logContext);
      performanceLog('image output bytes', {
        ...logContext,
        bytes: image.buffer.length,
      });
      const ext = extensionFromName(image.name);
      const objectKey = `cache/canvas/${key}.${ext}`;
      const contentType = imageContentType(image.name);
      if (!(await r2.putObject(objectKey, image.buffer, contentType, logContext))) {
        cacheStats.uploadFailures += 1;
        recordCanvasCache(logContext, 'failure');
        if (returnImageOnFailure) {
          bandwidthLog('cache fallback reused existing buffer', {
            ...logContext,
            cache: 'r2-put-failed',
            bytes: image.buffer.length,
          });
          return { image, cacheFailed: true, cache: 'r2-put-failed' };
        }
        return null;
      }

      const url = getAssetUrl(objectKey);
      cacheStats.uploadedBytes += image.buffer.length;
      await pool.query(
        `INSERT INTO canvas_cache (cache_key, object_key, url)
         VALUES ($1, $2, $3)
         ON CONFLICT (cache_key) DO UPDATE SET last_used_at = NOW()`,
        [key, objectKey, url]
      );
      remember(key, url);
      image = null;
      performanceLog('canvas cache miss', { ...logContext, cache: 'miss-uploaded', name: key.slice(0, 12) });
      return { url, cache: 'miss-uploaded' };
    } catch (err) {
      console.warn('[canvasCache] miss path failed:', err.message);
      if (returnImageOnFailure && image) {
        bandwidthLog('cache fallback reused existing buffer', {
          ...logContext,
          cache: 'miss-path-failed',
          bytes: image.buffer.length,
        });
        return { image, cacheFailed: true, cache: 'miss-path-failed' };
      }
      return null;
    }
  })();

  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

function isCanvasCacheExpired(lastUsedAt, now = Date.now()) {
  const timestamp = new Date(lastUsedAt).getTime();
  return Number.isFinite(timestamp) && now - timestamp > CANVAS_CACHE_RETENTION_MS;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Evict cache entries idle longer than the hardcoded retention window. The
 * database batch is deleted atomically first so an R2 outage cannot retain
 * expired Supabase rows; matching R2 objects are then removed best-effort.
 * Batches are oldest-first and paced so one sweep never hammers either service.
 */
async function sweepCanvasCache() {
  if (sweepRunning) {
    console.info('[CACHE CLEANUP] Skipped canvas_cache cleanup: another sweep is already running.');
    return 0;
  }

  sweepRunning = true;
  const startedAt = Date.now();
  let swept = 0;
  let batches = 0;
  let r2Deleted = 0;
  let r2Failures = 0;
  let cleanupErrors = 0;
  const cutoff = new Date(startedAt - CANVAS_CACHE_RETENTION_MS);

  console.info('[CACHE CLEANUP] Starting canvas_cache cleanup');
  console.info(
    `[CACHE CLEANUP] cutoff=${cutoff.toISOString()} `
    + `retention_days=${CANVAS_CACHE_MAX_AGE_DAYS} batch_size=${CANVAS_CACHE_SWEEP_BATCH_SIZE}`
  );
  try {
    while (true) {
      let rows;
      try {
        const result = await pool.query(
          `WITH expired AS (
             SELECT cache_key
               FROM canvas_cache
              WHERE last_used_at < $1
              ORDER BY last_used_at ASC
              LIMIT $2
              FOR UPDATE SKIP LOCKED
           )
           DELETE FROM canvas_cache cache
            USING expired
            WHERE cache.cache_key = expired.cache_key
           RETURNING cache.cache_key, cache.object_key`,
          [cutoff, CANVAS_CACHE_SWEEP_BATCH_SIZE]
        );
        rows = result.rows;
      } catch (err) {
        cleanupErrors += 1;
        console.error('[CACHE CLEANUP] canvas_cache database cleanup failed:', err.message);
        break;
      }

      if (rows.length === 0) break;
      batches += 1;

      for (const row of rows) {
        forgetMemory(row.cache_key);
      }
      swept += rows.length;

      console.info(`[CACHE CLEANUP] batch=${batches} deleted=${rows.length}`);

      // Database retention must not depend on an external object-store DELETE.
      // Once the expired rows are gone, remove R2 objects as best effort. A
      // bucket lifecycle rule can collect any object orphaned by an outage.
      if (r2.isConfigured()) {
        for (const row of rows) {
          let objectDeleted = false;
          let objectError = null;
          try {
            objectDeleted = await r2.deleteObject(row.object_key, {
              system: 'canvas',
              command: 'sweep',
            });
          } catch (err) {
            objectError = err;
          }
          if (objectDeleted) {
            r2Deleted += 1;
          } else {
            r2Failures += 1;
            console.warn('[CACHE CLEANUP] R2 cleanup failed after Supabase row deletion:', {
              cacheKey: row.cache_key,
              objectKey: row.object_key,
              ...(objectError ? { error: objectError.message } : {}),
            });
          }
        }
      }

      if (rows.length === CANVAS_CACHE_SWEEP_BATCH_SIZE) {
        await wait(CANVAS_CACHE_SWEEP_BATCH_DELAY_MS);
      }
    }
  } finally {
    sweepRunning = false;
    console.info(`[CACHE CLEANUP] database_deleted=${swept}`);
    console.info(`[CACHE CLEANUP] r2_deleted=${r2Deleted}`);
    console.info(`[CACHE CLEANUP] r2_failed=${r2Failures}`);
    console.info('[CACHE CLEANUP] Completed canvas_cache cleanup', {
      table: 'canvas_cache',
      batches,
      cleanupErrors,
      durationMs: Date.now() - startedAt,
    });
  }

  return swept;
}

async function verifyCanvasCacheReady() {
  if (!enabled()) return false;
  await pool.query(
    'SELECT cache_key, object_key, url, last_used_at FROM canvas_cache LIMIT 1'
  );
  return true;
}

function getCanvasCacheStats() {
  const directRequests = cacheStats.memoryHits + cacheStats.dbHits + cacheStats.misses;
  const effectiveRequests = directRequests + cacheStats.inflightHits;
  return {
    ...cacheStats,
    hitRate: directRequests
      ? Number(((cacheStats.memoryHits + cacheStats.dbHits) / directRequests).toFixed(4))
      : 0,
    effectiveHitRate: effectiveRequests
      ? Number(((cacheStats.memoryHits + cacheStats.dbHits + cacheStats.inflightHits) / effectiveRequests).toFixed(4))
      : 0,
    entries: memory.size,
    inflight: inflight.size,
    touches: lastTouched.size,
    maxEntries: MEMORY_MAX,
    bytes: memoryBytes,
    maxBytes: MEMORY_MAX_BYTES,
    enabled: enabled(),
    sweepRunning,
  };
}

registerMemorySource('canvas.urls', getCanvasCacheStats);
registerMemorySource('canvas.inflight', () => ({ entries: inflight.size }));
registerMemorySource('canvas.touch-throttle', () => ({ entries: lastTouched.size }));

module.exports = {
  getCachedCanvasUrl,
  sweepCanvasCache,
  verifyCanvasCacheReady,
  getCanvasCacheStats,
  CANVAS_CACHE_RETENTION_MS,
  CANVAS_CACHE_MAX_AGE_DAYS,
  CANVAS_CACHE_SWEEP_BATCH_SIZE,
  CANVAS_CACHE_SWEEP_BATCH_DELAY_MS,
  // Selftest-only hook (scripts/lifecycle-guard-selftest.js): lets the
  // lastTouched prune bound be exercised without a database or R2.
  __test: {
    touch,
    lastTouched,
    MEMORY_MAX,
    isCanvasCacheExpired,
    CANVAS_CACHE_RETENTION_MS,
    CANVAS_CACHE_SWEEP_BATCH_SIZE,
    CANVAS_CACHE_SWEEP_BATCH_DELAY_MS,
  },
};
