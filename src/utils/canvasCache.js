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

const MEMORY_MAX = 5000;
const MEMORY_MAX_BYTES = Math.max(1024 * 1024, envNumber('CANVAS_MEMORY_CACHE_MAX_MB', 128, { min: 1, max: 2048 }) * 1024 * 1024);
const memory = new Map(); // cacheKey → url (insertion-ordered; trimmed FIFO)
const inflight = new Map(); // cacheKey → Promise<{url}|null>
const lastTouched = new Map(); // cacheKey -> ms timestamp of last last_used_at write
let memoryBytes = 0;
let warnedDb = false;

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
  const entry = memory.get(key);
  if (!entry) return;
  memory.delete(key);
  memoryBytes = Math.max(0, memoryBytes - (typeof entry === 'string' ? estimateUrlBytes(entry) : entry.bytes));
  lastTouched.delete(key);
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
  lastTouched.set(key, now);
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
    memory.delete(key);
    memory.set(key, cachedEntry);
    touch(key, logContext);
    performanceLog('canvas cache hit', { ...logContext, cache: 'memory-hit', name: key.slice(0, 12) });
    return { url: typeof cachedEntry === 'string' ? cachedEntry : cachedEntry.url, cache: 'memory-hit' };
  }
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    try {
      const { rows } = await pool.query(
        'SELECT url FROM canvas_cache WHERE cache_key = $1', [key]
      );
      if (rows.length > 0) {
        remember(key, rows[0].url);
        touch(key, logContext);
        performanceLog('canvas cache hit', { ...logContext, cache: 'db-hit', name: key.slice(0, 12) });
        return { url: rows[0].url, cache: 'db-hit' };
      }
    } catch (err) {
      dbWarn(err);
      return null;
    }

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
      if (!(await r2.putObject(objectKey, image.buffer, contentType))) {
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

/**
 * Evict cache entries idle longer than maxAgeDays: delete the R2 object first,
 * then the row (a row is only dropped once its object is gone/404). Batched so
 * one sweep never hammers the API. Wired to a 6h interval in index.js.
 */
async function sweepCanvasCache({ maxAgeDays = Number(process.env.CANVAS_CACHE_MAX_AGE_DAYS || 14), batch = 200 } = {}) {
  if (!enabled()) return 0;
  let swept = 0;
  try {
    const { rows } = await pool.query(
      `SELECT cache_key, object_key FROM canvas_cache
        WHERE last_used_at < NOW() - ($1 || ' days')::interval
        LIMIT $2`,
      [String(maxAgeDays), batch]
    );
    for (const row of rows) {
      if (!(await r2.deleteObject(row.object_key))) continue;
      await pool.query('DELETE FROM canvas_cache WHERE cache_key = $1', [row.cache_key]);
      forgetMemory(row.cache_key);
      swept += 1;
    }
    if (swept > 0) console.log(`[canvasCache] swept ${swept} cold cache object(s).`);
  } catch (err) {
    dbWarn(err);
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
  return {
    entries: memory.size,
    inflight: inflight.size,
    touches: lastTouched.size,
    maxEntries: MEMORY_MAX,
    bytes: memoryBytes,
    maxBytes: MEMORY_MAX_BYTES,
    enabled: enabled(),
  };
}

module.exports = {
  getCachedCanvasUrl,
  sweepCanvasCache,
  verifyCanvasCacheReady,
  getCanvasCacheStats,
};
