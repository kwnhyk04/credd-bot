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
const fs = require('fs');

const cache = new Map(); // key → Promise<Buffer>
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

async function build(srcPath, { W, H, contentH }, animated) {
  const meta = await sharp(srcPath, { animated }).metadata();
  const srcH = animated ? (meta.pageHeight || meta.height) : meta.height;
  const w = Math.max(1, Math.round(contentH * (meta.width / srcH)));
  const left = Math.max(0, Math.floor((W - w) / 2));
  const right = Math.max(0, W - w - left);
  const top = Math.max(0, Math.floor((H - contentH) / 2));
  const bottom = Math.max(0, H - contentH - top);
  const pipe = sharp(srcPath, { animated })
    .resize({ height: contentH })
    .extend({ left, right, top, bottom, background: transparent });
  return animated ? pipe.gif().toBuffer() : pipe.png().toBuffer();
}

function pad(srcPath, dims, animated) {
  const key = `${srcPath}|${dims.W}x${dims.H}@${dims.contentH}|${animated ? 'g' : 'p'}`;
  if (!cache.has(key)) {
    cache.set(key, build(srcPath, dims, animated).catch((err) => {
      console.error('[imagePad]', srcPath, err.message);
      try { return fs.readFileSync(srcPath); } catch { return Buffer.alloc(0); }
    }));
  }
  return cache.get(key);
}

const padGif = (srcPath, dims) => pad(srcPath, dims, true);
const padPng = (srcPath, dims) => pad(srcPath, dims, false);

/** Total play time (ms) of an animated GIF — sum of frame delays. Cached. Falls back to 3000. */
const durCache = new Map();
function gifDuration(srcPath) {
  if (!durCache.has(srcPath)) {
    durCache.set(srcPath, sharp(srcPath, { animated: true }).metadata()
      .then((m) => (m.delay || []).reduce((a, b) => a + (b || 0), 0) || 3000)
      .catch(() => 3000));
  }
  return durCache.get(srcPath);
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
    meta.push(await sharp(r, { animated: true }).metadata());
    raw.push(await sharp(r, { animated: true }).resize({ width: tile, height: tile, fit: 'fill' }).raw().toBuffer());
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
  if (!stripCache.has(key)) {
    stripCache.set(key, buildReelStrip(reelPaths, { tile, gap, panelW, step }).catch((err) => {
      console.error('[imagePad] reelStrip', err.message);
      return fs.readFileSync(reelPaths[0]);
    }));
  }
  return stripCache.get(key);
}

/** Fire-and-forget warm-up for the fixed (non-card) assets so the first spin isn't slow. */
function prewarm(jobs) {
  for (const j of jobs) (j.animated ? padGif : padPng)(j.path, j.dim).catch(() => {});
}

module.exports = { padGif, padPng, gifDuration, reelStripGif, prewarm };
