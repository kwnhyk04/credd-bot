'use strict';

/**
 * imagePad.js — normalize every casino image (GIF or PNG) onto a FIXED canvas so the spin frame
 * and the result frame of a game are pixel-consistent in size.
 *
 * Discord stretches a media item to its cell width, so the only way to make art look "small" is
 * transparent side/top padding. We resize each source to a target content height, then center it
 * on a W×H transparent canvas. The GIF (animated, per-frame) and the matching PNG use the SAME
 * dimensions, so the GIF→PNG swap keeps the exact same footprint.
 *
 * sharp handles animated GIFs per-frame (resize + extend operate on every page). Buffers are
 * cached in memory by source+dimensions (the roster of distinct assets is small). On any failure
 * we fall back to the raw file bytes so a render never crashes.
 */

const sharp = require('sharp');
require('../utils/imageRuntime').configureImageRuntime();
const {
  assetSource, fetchAssetBuffer, isRemoteSource, isRemoteAssetsEnabled,
} = require('../utils/assets');
const { envNumber, envPositiveInt } = require('../utils/runtimeLogs');
const { registerMemorySource } = require('../utils/memoryRegistry');

const BUFFER_CACHE_MAX_ENTRIES = envPositiveInt('CASINO_MEDIA_CACHE_MAX', 12, { max: 100 });
const BUFFER_CACHE_MAX_BYTES = Math.max(
  1024 * 1024,
  envNumber('CASINO_MEDIA_CACHE_MAX_MB', 24, { min: 1, max: 512 }) * 1024 * 1024
);
const BUFFER_CACHE_TTL_MS = Math.max(
  0,
  envNumber('CASINO_MEDIA_CACHE_TTL_MS', 600_000, { min: 0, max: 86_400_000 })
);
const cache = new Map(); // key -> { promise, bytes, lastUsed }
let bufferCacheBytes = 0;
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

function dropBufferEntry(map, key) {
  const entry = map.get(key);
  if (!entry) return;
  map.delete(key);
  bufferCacheBytes = Math.max(0, bufferCacheBytes - entry.bytes);
}

function trimBufferCaches(now = Date.now()) {
  for (const map of [cache, stripCache]) {
    if (BUFFER_CACHE_TTL_MS) {
      for (const [key, entry] of map) {
        if (now - entry.lastUsed > BUFFER_CACHE_TTL_MS) dropBufferEntry(map, key);
      }
    }
  }
  while (cache.size + stripCache.size > BUFFER_CACHE_MAX_ENTRIES || bufferCacheBytes > BUFFER_CACHE_MAX_BYTES) {
    const firstPad = cache.entries().next().value;
    const firstStrip = stripCache.entries().next().value;
    if (!firstPad && !firstStrip) break;
    if (!firstStrip || (firstPad && firstPad[1].lastUsed <= firstStrip[1].lastUsed)) {
      dropBufferEntry(cache, firstPad[0]);
    } else {
      dropBufferEntry(stripCache, firstStrip[0]);
    }
  }
}

function cachedBuffer(map, key, builder) {
  const hit = map.get(key);
  if (hit) {
    hit.lastUsed = Date.now();
    map.delete(key);
    map.set(key, hit);
    return hit.promise;
  }
  const entry = { bytes: 0, lastUsed: Date.now(), promise: null };
  entry.promise = builder().then((buffer) => {
    if (map.get(key) === entry && Buffer.isBuffer(buffer)) {
      entry.bytes = buffer.length;
      bufferCacheBytes += entry.bytes;
      trimBufferCaches();
    }
    return buffer;
  }).catch((err) => {
    dropBufferEntry(map, key);
    throw err;
  });
  map.set(key, entry);
  trimBufferCaches();
  return entry.promise;
}

async function sharpInput(srcPath) {
  const resolved = assetSource(srcPath);
  return isRemoteSource(resolved) ? fetchAssetBuffer(resolved) : resolved;
}

async function build(srcPath, { W, H, contentH }, animated) {
  const input = await sharpInput(srcPath);
  const meta = await sharp(input, { animated }).metadata();
  const srcH = animated ? (meta.pageHeight || meta.height) : meta.height;
  const w = Math.max(1, Math.round(contentH * (meta.width / srcH)));
  const left = Math.max(0, Math.floor((W - w) / 2));
  const right = Math.max(0, W - w - left);
  const top = Math.max(0, Math.floor((H - contentH) / 2));
  const bottom = Math.max(0, H - contentH - top);
  const pipe = sharp(input, { animated })
    .resize({ height: contentH })
    .extend({ left, right, top, bottom, background: transparent });
  return animated ? pipe.gif().toBuffer() : pipe.png().toBuffer();
}

function pad(srcPath, dims, animated) {
  const key = `${srcPath}|${dims.W}x${dims.H}@${dims.contentH}|${animated ? 'g' : 'p'}`;
  return cachedBuffer(cache, key, () => build(srcPath, dims, animated).catch((err) => {
      console.error('[imagePad]', srcPath, err.message);
      return fetchAssetBuffer(srcPath).catch(() => Buffer.alloc(0));
    }));
}

const padGif = (srcPath, dims) => pad(srcPath, dims, true);
const padPng = (srcPath, dims) => pad(srcPath, dims, false);

/** Total play time (ms) of an animated GIF — sum of frame delays. Cached. Falls back to 3000. */
const durCache = new Map();
function gifDuration(srcPath) {
  const hit = durCache.get(srcPath);
  if (hit) {
    hit.lastUsed = Date.now();
    durCache.delete(srcPath);
    durCache.set(srcPath, hit);
    return hit.promise;
  }
  const entry = {
    lastUsed: Date.now(),
    promise: sharpInput(srcPath).then((input) => sharp(input, { animated: true }).metadata())
      .then((m) => (m.delay || []).reduce((a, b) => a + (b || 0), 0) || 3000)
      .catch(() => 3000),
  };
  durCache.set(srcPath, entry);
  while (durCache.size > 64) durCache.delete(durCache.keys().next().value);
  return entry.promise;
}

/**
 * Composite several reel GIFs into ONE animated strip (so 3 reels render on a single line — a
 * media gallery would otherwise mosaic 3 items as 1-big-2-small). Reels keep their stagger: a reel
 * holds its final frame once its own animation ends. Frames are sampled (`step`) to keep the encode
 * fast (~1.5s). Cached in memory by the reel set + dims.
 */
const stripCache = new Map();
async function buildReelStrip(reelPaths, { tile, gap, panelW, step }) {
  const meta = [];
  const raw = [];
  for (const r of reelPaths) {
    const input = await sharpInput(r);
    meta.push(await sharp(input, { animated: true }).metadata());
    raw.push(await sharp(input, { animated: true }).resize({ width: tile, height: tile, fit: 'fill' }).raw().toBuffer());
  }
  const pages = meta.map((m) => m.pages || 1);
  const P = Math.max(...pages);
  const content = reelPaths.length * tile + (reelPaths.length - 1) * gap;
  const left0 = Math.floor((panelW - content) / 2);
  const frameBytes = tile * tile * 4;
  const frames = [];
  for (let k = 0; k < P; k += step) {
    const comps = reelPaths.map((_, i) => {
      const fk = Math.min(k, pages[i] - 1);
      const off = fk * frameBytes;
      return { input: raw[i].subarray(off, off + frameBytes), raw: { width: tile, height: tile, channels: 4 }, top: 0, left: left0 + i * (tile + gap) };
    });
    frames.push(await sharp({ create: { width: panelW, height: tile + 4, channels: 4, background: transparent } }).composite(comps).png().toBuffer());
  }
  const longest = Math.max(...meta.map((m) => (m.delay || []).reduce((a, b) => a + (b || 0), 0)));
  const longestIndex = meta.findIndex((m) => (m.delay || []).reduce((a, b) => a + (b || 0), 0) === longest);
  const sourceDelays = meta[longestIndex]?.delay || [];
  const delays = frames.map((_, i) => {
    const start = i * step;
    const bucket = sourceDelays.slice(start, start + step).reduce((a, b) => a + (b || 0), 0);
    return Math.max(20, bucket || Math.round((longest || 3000) / frames.length));
  });
  return sharp(frames, { join: { animated: true } }).gif({ delay: delays }).toBuffer();
}

function reelStripGif(reelPaths, { tile = 92, gap = 14, panelW = 460, step = 2 } = {}) {
  const key = `${reelPaths.join('|')}@${tile}x${gap}x${panelW}/${step}`;
  return cachedBuffer(stripCache, key, () => buildReelStrip(reelPaths, { tile, gap, panelW, step }).catch((err) => {
      console.error('[imagePad] reelStrip', err.message);
      return fetchAssetBuffer(reelPaths[0]).catch(() => Buffer.alloc(0));
    }));
}

/** Fire-and-forget warm-up for the fixed (non-card) assets so the first spin isn't slow. */
function prewarm(jobs) {
  if (isRemoteAssetsEnabled()) return;
  for (const j of jobs) (j.animated ? padGif : padPng)(j.path, j.dim).catch(() => {});
}

function getCasinoMediaCacheStats() {
  trimBufferCaches();
  return {
    paddedEntries: cache.size,
    reelEntries: stripCache.size,
    durationEntries: durCache.size,
    bytes: bufferCacheBytes,
    maxEntries: BUFFER_CACHE_MAX_ENTRIES,
    maxBytes: BUFFER_CACHE_MAX_BYTES,
    ttlMs: BUFFER_CACHE_TTL_MS,
  };
}

registerMemorySource('casino.processed-media', getCasinoMediaCacheStats);

module.exports = { padGif, padPng, gifDuration, reelStripGif, prewarm, getCasinoMediaCacheStats };
