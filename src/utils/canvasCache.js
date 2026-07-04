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
 * Object layout: cache/canvas/<sha256[0..39]>.<jpg|png> in the ASSET_BASE_URL
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
const { optimizeOpaqueAttachment } = require('./imageOutput');

const MEMORY_MAX = 5000;
const memory = new Map(); // cacheKey → url (insertion-ordered; trimmed FIFO)
const inflight = new Map(); // cacheKey → Promise<{url}|null>
let warnedDb = false;

function enabled() {
  return isRemoteAssetsEnabled() && r2.isConfigured();
}

function hashParts(parts) {
  const payload = JSON.stringify([assetVersion(), parts]);
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 40);
}

function remember(key, url) {
  memory.set(key, url);
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
}

function touch(key) {
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
 * @returns {Promise<{url:string}|null>}  null → caller must attach as before
 */
async function getCachedCanvasUrl(parts, renderPng) {
  if (!enabled()) return null;
  const key = hashParts(parts);

  const cachedUrl = memory.get(key);
  if (cachedUrl) {
    touch(key);
    return { url: cachedUrl };
  }
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    try {
      const { rows } = await pool.query(
        'SELECT url FROM canvas_cache WHERE cache_key = $1', [key]
      );
      if (rows.length > 0) {
        remember(key, rows[0].url);
        touch(key);
        return { url: rows[0].url };
      }
    } catch (err) {
      dbWarn(err);
      return null;
    }

    try {
      const png = await renderPng();
      // Same encoder as the attach path → byte-identical visuals either way.
      const image = await optimizeOpaqueAttachment(png, 'canvas');
      const ext = image.name.endsWith('.jpg') ? 'jpg' : 'png';
      const objectKey = `cache/canvas/${key}.${ext}`;
      const contentType = ext === 'jpg' ? 'image/jpeg' : 'image/png';
      if (!(await r2.putObject(objectKey, image.buffer, contentType))) return null;

      const url = getAssetUrl(objectKey);
      await pool.query(
        `INSERT INTO canvas_cache (cache_key, object_key, url)
         VALUES ($1, $2, $3)
         ON CONFLICT (cache_key) DO UPDATE SET last_used_at = NOW()`,
        [key, objectKey, url]
      );
      remember(key, url);
      return { url };
    } catch (err) {
      console.warn('[canvasCache] miss path failed:', err.message);
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
      memory.delete(row.cache_key);
      swept += 1;
    }
    if (swept > 0) console.log(`[canvasCache] swept ${swept} cold cache object(s).`);
  } catch (err) {
    dbWarn(err);
  }
  return swept;
}

module.exports = { getCachedCanvasUrl, sweepCanvasCache };
