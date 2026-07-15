'use strict';

/**
 * casinoCanvas.js — static, CENTERED result art (small images + small auto-fitting text).
 *
 * Discord scales a media item to its cell, so to look small + centered we composite each result
 * into one image: a centered row of small images (`strip`/`cardStrip`) and a small centered text
 * block (`resultStrip`). Fonts are intentionally tiny and auto-shrink to never overflow the panel.
 * Cards are composited as-is ([v4.7]: no rank-text overlay — the PNG art already shows the rank).
 * Crash's body is a compact drawn panel. @napi-rs/canvas with the bundled DejaVu Sans family.
 */

// Install Canvas accounting before destructuring createCanvas. index.js does this globally too,
// but keeping the renderer self-contained also covers scripts and focused tests.
require('../utils/imageRuntime').configureImageRuntime();
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const sharp = require('sharp');
const { encodeCanvas, releaseCanvas } = require('../utils/canvasEncode');
const path = require('path');
const pool = require('../db/pool');
const { rankLabel, SUIT_LABEL } = require('./cardDeck');
const {
  assetPath,
  assetSource,
  loadAssetImage: loadAssetImageSource,
  loadCachedBuffer,
} = require('../utils/assets');
const { envNumber, envPositiveInt } = require('../utils/runtimeLogs');
const { registerMemorySource } = require('../utils/memoryRegistry');

const ROOT = path.join(__dirname, '..', '..');
const FONT = 'DejaVu Sans';
for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
  try { GlobalFonts.registerFromPath(path.join(ROOT, 'assets', 'fonts', file), FONT); }
  catch (err) { console.error(`[casinoCanvas] font ${file}:`, err.message); }
}

const PANEL_W = 460;
const COLORS = {
  panel: '#1c1d22', text: '#e7e9ec', dim: '#9aa0a8',
  gold: '#e0a526', green: '#43d675', red: '#f23f43', grey: '#95a5a6',
};

function loadCached(p) {
  const resolved = assetSource(p);
  return loadAssetImageSource(loadImage, resolved).catch(() => null);
}

// Card source art is 1024x1536 or larger but ends up on a 140x196 face. Resize
// it with bounded Sharp work before Canvas decodes it; retaining or repeatedly
// decoding the full source in Skia left hundreds of MB warm after the small
// face had already been produced. The final face dimensions and source detail
// are preserved, using Lanczos downsampling at the exact displayed resolution.
async function loadCardBackground(p, width, height) {
  try {
    const source = await loadCachedBuffer(assetSource(p));
    const buffer = await sharp(source)
      .ensureAlpha()
      .resize({ width, height, fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    return await loadImage(buffer);
  } catch {
    return null;
  }
}

async function loadCardGlyph(p, targetHeight) {
  try {
    const source = await loadCachedBuffer(assetSource(p));
    const metadata = await sharp(source).metadata();
    const { data, info } = await sharp(source)
      .ensureAlpha()
      // Match the former Canvas alpha scan's cutoff so pre-resizing changes
      // memory behavior without changing the visible glyph bounds.
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 12 })
      .resize({ height: targetHeight, kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer({ resolveWithObject: true });
    return {
      image: await loadImage(data),
      sourceWidth: metadata.width || info.width,
      sourceHeight: metadata.height || info.height,
      drawWidth: info.width,
      drawHeight: info.height,
    };
  } catch {
    return null;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawContain(ctx, img, bx, by, bw, bh) {
  if (!img) return;
  const scale = Math.min(bw / img.width, bh / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, bx + (bw - w) / 2, by + (bh - h) / 2, w, h);
}

/* ───────────────────── CARD FACE COMPOSITING (CardRender) ─────────────────────
 * Each card face is assembled on Canvas from pre-made PNGs instead of one flat
 * per-card image: a suit canvas background (full card), the number PNG in the top
 * half, and the suit symbol (or a royal face PNG for J/Q/K) in the bottom half.
 * Asset paths follow the on-disk layout (number PNGs live under the capitalised
 * suit folder as `{suit}_{rank}.png`, NOT bare value names). Any missing asset
 * falls back to a programmatic card for THAT card only and logs the path to
 * dev_logs — the game never crashes on a missing file.
 */
const CARDS_IMG = 'casino/cards/img';
const CARD_CANVAS_DIR = `${CARDS_IMG}/Card Canvas`;
const ROYAL_RANKS = new Set(['j', 'q', 'k']);
const CARD_RANK_HEIGHT_FRAC = 0.85 * 0.75;
const CARD_SYMBOL_HEIGHT_FRAC = 0.85;
const CARD_RANK_Y_OFFSET_FRAC = 0.035;
const CARD_SYMBOL_Y_OFFSET_FRAC = -0.04;
const capSuit = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const canvasBgPath = (suit) => assetPath(`${CARD_CANVAS_DIR}/${suit}_canvas.png`);
const numberPngPath = (suit, rank) => assetPath(`${CARDS_IMG}/${capSuit(suit)}/${suit}_${rank}.png`);
const symbolPngPath = (suit) => assetPath(`${CARDS_IMG}/${suit}.png`);
const royalPngPath = (suit, rank) => assetPath(`${CARDS_IMG}/${suit}_royal_${rank}.png`);

// Fire-and-forget dev_logs note for a missing asset, deduped so one bad path logs once.
const loggedMissing = new Set();
function logMissingAsset(p) {
  if (loggedMissing.has(p)) return;
  loggedMissing.add(p);
  while (loggedMissing.size > 200) loggedMissing.delete(loggedMissing.values().next().value);
  pool.query(
    `INSERT INTO dev_logs (dev_id, action_type, target_discord_id, amount_or_detail)
     VALUES ('system', 'asset_missing', 'system', $1)`,
    [`card render: ${p}`.slice(0, 200)]
  ).catch(() => {});
}

// Programmatic fallback card (the old flat draw) — used only when an asset is missing.
function programmaticFace(card) {
  const cv = createCanvas(140, 196);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f4ecd8';
  roundRect(ctx, 2, 2, 136, 192, 12); ctx.fill();
  ctx.strokeStyle = '#9a8c6a'; ctx.lineWidth = 2;
  roundRect(ctx, 2, 2, 136, 192, 12); ctx.stroke();
  ctx.fillStyle = '#2a2a2a';
  ctx.textAlign = 'center';
  ctx.font = `bold 48px ${FONT}`;
  ctx.fillText(rankLabel(card.rank), 70, 74);
  ctx.font = `18px ${FONT}`;
  ctx.fillText(SUIT_LABEL[card.suit] || card.suit, 70, 150);
  return cv;
}

function placePreparedGlyph(ctx, prepared, W, H, half, label, yOffsetFrac = 0) {
  const { image, drawWidth, drawHeight, sourceWidth, sourceHeight } = prepared;
  const halfH = H * 0.5;
  const drawX = Math.floor((W - drawWidth) / 2);
  const baseY = half === 'top'
    ? Math.floor((halfH - drawHeight) / 2)
    : Math.floor(halfH + (halfH - drawHeight) / 2);
  const drawY = baseY + Math.floor(H * yOffsetFrac);
  console.log(`[cardFace] ${label} src=${sourceWidth}x${sourceHeight} prepared=${drawWidth}x${drawHeight} @(${drawX},${drawY}) halfH=${Math.floor(halfH)}`);
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

async function buildCardFace(card) {
  const { suit, rank } = card;
  const W = 140, H = 196;
  const rankHeight = Math.floor(H * 0.5 * CARD_RANK_HEIGHT_FRAC);
  const symbolHeight = Math.floor(H * 0.5 * CARD_SYMBOL_HEIGHT_FRAC);
  const bg = await loadCardBackground(canvasBgPath(suit), W, H);
  if (!bg) { logMissingAsset(canvasBgPath(suit)); return programmaticFace(card); }

  const numImg = await loadCardGlyph(numberPngPath(suit, rank), rankHeight);
  if (!numImg) { logMissingAsset(numberPngPath(suit, rank)); return programmaticFace(card); }

  // Symbol zone: royal face PNG for J/Q/K, else the generic suit symbol. A missing
  // royal degrades to the generic symbol (not a full fallback); a missing symbol
  // forces the programmatic fallback.
  let symImg = null;
  if (ROYAL_RANKS.has(rank)) {
    symImg = await loadCardGlyph(royalPngPath(suit, rank), symbolHeight);
    if (!symImg) { logMissingAsset(royalPngPath(suit, rank)); symImg = await loadCardGlyph(symbolPngPath(suit), symbolHeight); }
  } else {
    symImg = await loadCardGlyph(symbolPngPath(suit), symbolHeight);
  }
  if (!symImg) { logMissingAsset(symbolPngPath(suit)); return programmaticFace(card); }

  // Cache small working faces because full-size canvases retained about 312 MB across the deck.
  const cv = createCanvas(W, H);
  try {
    const ctx = cv.getContext('2d');
    console.log(`[cardFace] ${suit} ${rank} card=${W}x${H}`);
    ctx.drawImage(bg, 0, 0, W, H);                            // layer 1: full-card background
    placePreparedGlyph(ctx, numImg, W, H, 'top', `${suit} ${rank} number`, CARD_RANK_Y_OFFSET_FRAC);
    placePreparedGlyph(ctx, symImg, W, H, 'bottom', `${suit} ${rank} symbol`, CARD_SYMBOL_Y_OFFSET_FRAC);
    return cv;
  } catch (err) {
    releaseCanvas(cv);
    throw err;
  }
}

// Composited card faces are cached by suit_rank (a face is identical every time).
const FACE_CACHE_MAX_ENTRIES = envPositiveInt('CASINO_CARD_FACE_CACHE_MAX', 8, { max: 52 });
const FACE_CACHE_MAX_BYTES = Math.max(
  1024 * 1024,
  envNumber('CASINO_CARD_FACE_CACHE_MAX_MB', 4, { min: 1, max: 128 }) * 1024 * 1024
);
const FACE_CACHE_TTL_MS = Math.max(
  0,
  envNumber('CASINO_CARD_FACE_CACHE_TTL_MS', 600_000, { min: 0, max: 86_400_000 })
);
const faceCache = new Map(); // key -> { promise, canvas, bytes, leases, releaseWhenIdle, ... }
let faceCacheBytes = 0;
let faceLeases = 0;
let faceReleasedCanvases = 0;
let faceDeferredReleases = 0;

function releaseFaceCanvas(entry) {
  if (!entry?.canvas || entry.canvasReleased) return;
  releaseCanvas(entry.canvas);
  entry.canvas = null;
  entry.canvasReleased = true;
  faceReleasedCanvases += 1;
}

function dropFace(key) {
  const entry = faceCache.get(key);
  if (!entry) return;
  faceCache.delete(key);
  faceCacheBytes = Math.max(0, faceCacheBytes - entry.bytes);
  entry.bytes = 0;
  entry.releaseWhenIdle = true;
  if (entry.canvas && entry.leases === 0) releaseFaceCanvas(entry);
  else if (entry.leases > 0) faceDeferredReleases += 1;
}

function trimFaceCache(now = Date.now()) {
  if (FACE_CACHE_TTL_MS) {
    for (const [key, entry] of faceCache) {
      if (now - entry.lastUsed > FACE_CACHE_TTL_MS) dropFace(key);
    }
  }
  while (faceCache.size > FACE_CACHE_MAX_ENTRIES || faceCacheBytes > FACE_CACHE_MAX_BYTES) {
    dropFace(faceCache.keys().next().value);
  }
}

function faceEntry(card) {
  const key = `${card.suit}_${card.rank}`;
  const cached = faceCache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    faceCache.delete(key);
    faceCache.set(key, cached);
    return cached;
  }
  const entry = {
    bytes: 0,
    canvas: null,
    canvasReleased: false,
    createdAt: Date.now(),
    lastUsed: Date.now(),
    leases: 0,
    promise: null,
    releaseWhenIdle: false,
  };
  entry.promise = buildCardFace(card).then((canvas) => {
    entry.canvas = canvas;
    if (faceCache.get(key) === entry) {
      entry.bytes = Math.max(1, canvas.width * canvas.height * 4);
      faceCacheBytes += entry.bytes;
      trimFaceCache();
    } else {
      entry.releaseWhenIdle = true;
      if (entry.leases === 0) releaseFaceCanvas(entry);
    }
    return canvas;
  }).catch((err) => {
    dropFace(key);
    throw err;
  });
  faceCache.set(key, entry);
  trimFaceCache();
  return entry;
}

function releaseFaceLease(entry) {
  if (!entry || entry.leases <= 0) return;
  entry.leases -= 1;
  faceLeases = Math.max(0, faceLeases - 1);
  if (entry.leases === 0 && entry.releaseWhenIdle) releaseFaceCanvas(entry);
}

async function acquireCardFace(card) {
  const entry = faceEntry(card);
  entry.leases += 1;
  faceLeases += 1;
  try {
    const image = await entry.promise;
    let released = false;
    return {
      image,
      release() {
        if (released) return;
        released = true;
        releaseFaceLease(entry);
      },
    };
  } catch (err) {
    releaseFaceLease(entry);
    throw err;
  }
}

function clearCasinoCanvasCache() {
  for (const key of [...faceCache.keys()]) dropFace(key);
}

function getCasinoCanvasCacheStats() {
  trimFaceCache();
  return {
    faceEntries: faceCache.size,
    faceBytes: faceCacheBytes,
    faceMaxEntries: FACE_CACHE_MAX_ENTRIES,
    faceMaxBytes: FACE_CACHE_MAX_BYTES,
    faceTtlMs: FACE_CACHE_TTL_MS,
    faceLeases,
    faceReleasedCanvases,
    faceDeferredReleases,
    missingAssetEntries: loggedMissing.size,
  };
}

registerMemorySource('casino.card-faces', getCasinoCanvasCacheStats);

/** A centered row of small square images (coin / dice / slot faces). */
async function strip(paths, { tile = 92, gap = 16, panelW = PANEL_W, padY = 10 } = {}) {
  const imgs = await Promise.all(paths.map(loadCached));
  const canvas = createCanvas(panelW, tile + padY * 2);
  const ctx = canvas.getContext('2d');
  const total = imgs.length * tile + (imgs.length - 1) * gap;
  let x = (panelW - total) / 2;
  for (const im of imgs) { drawContain(ctx, im, x, padY, tile, tile); x += tile + gap; }
  return encodeCanvas(canvas);
}

/**
 * A centered row of small cards. Each entry is either a card object `{suit, rank}` —
 * composited on Canvas from the suit background + number + symbol/royal PNGs
 * (CardRender) — or a path string (the dealer's `card_back.png`, or a fallback).
 * @param {(object|string)[]} entries
 */
async function cardStrip(entries, { cardW = 64, cardH = 90, gap = 12, panelW = PANEL_W, padY = 10 } = {}) {
  const resourcePromises = entries.map(async (entry) => (
    typeof entry === 'string'
      ? { image: await loadCached(entry), release: null }
      : acquireCardFace(entry)
  ));
  let resources;
  try {
    resources = await Promise.all(resourcePromises);
  } catch (err) {
    // Promise.all does not expose already-acquired leases when a sibling fails.
    const settled = await Promise.allSettled(resourcePromises);
    for (const item of settled) {
      if (item.status === 'fulfilled') item.value.release?.();
    }
    throw err;
  }

  let canvas = null;
  try {
    canvas = createCanvas(panelW, cardH + padY * 2);
    const ctx = canvas.getContext('2d');
    const total = entries.length * cardW + (entries.length - 1) * gap;
    let x = (panelW - total) / 2;
    for (const resource of resources) {
      drawContain(ctx, resource.image, x, padY, cardW, cardH);
      x += cardW + gap;
    }
    const output = encodeCanvas(canvas);
    canvas = null;
    return output;
  } finally {
    if (canvas) releaseCanvas(canvas);
    for (const resource of resources) resource.release?.();
  }
}

/**
 * A small CENTERED text block (verdict + win/lose banner). Each line auto-shrinks to fit the
 * panel width so it never overflows. @param {{text,size?,color?,bold?,gap?}[]} lines
 */
async function resultStrip(lines, { panelW = PANEL_W } = {}) {
  const measureCanvas = createCanvas(8, 8);
  const measure = measureCanvas.getContext('2d');
  const maxW = panelW - 28;
  let fitted;
  try {
    fitted = lines.map((l) => {
      let size = l.size || 11;
      measure.font = `${l.bold ? 'bold ' : ''}${size}px ${FONT}`;
      const w = measure.measureText(l.text).width;
      if (w > maxW) size = Math.max(6, Math.floor(size * maxW / w));
      return { ...l, size };
    });
  } finally {
    releaseCanvas(measureCanvas);
  }
  const padY = 6;
  let h = padY * 2;
  for (const l of fitted) h += l.size + (l.gap ?? 6);
  const canvas = createCanvas(panelW, h);
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  let y = padY;
  for (const l of fitted) {
    y += l.size;
    ctx.fillStyle = l.color || COLORS.text;
    ctx.font = `${l.bold ? 'bold ' : ''}${l.size}px ${FONT}`;
    ctx.fillText(l.text, panelW / 2, y);
    y += (l.gap ?? 6);
  }
  return encodeCanvas(canvas);
}

/** Crash multiplier body — compact fonts per feedback. */
async function crashPanel({ multiplier, crashed, crashPoint, bet, pushes }) {
  const W = PANEL_W;
  const H = 104;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, 2, 2, W - 4, H - 4, 12); ctx.fill();
  ctx.strokeStyle = crashed ? COLORS.red : COLORS.gold;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 2, 2, W - 4, H - 4, 12); ctx.stroke();

  ctx.textAlign = 'center';
  if (crashed) {
    ctx.fillStyle = COLORS.red;
    ctx.font = `bold 24px ${FONT}`;
    ctx.fillText('CRASH', W / 2, 38);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`Crashed at ${crashPoint}×`, W / 2, 62);
  } else {
    ctx.fillStyle = COLORS.gold;
    ctx.font = `bold 26px ${FONT}`;
    ctx.fillText(`${multiplier}×`, W / 2, 40);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`Cash-out value: ${Math.floor(bet * multiplier).toLocaleString()} Credux`, W / 2, 63);
  }
  ctx.fillStyle = COLORS.text;
  ctx.font = `11px ${FONT}`;
  ctx.fillText(`Pushes survived: ${pushes}`, W / 2, 86);
  return encodeCanvas(canvas);
}

module.exports = {
  strip,
  cardStrip,
  resultStrip,
  crashPanel,
  clearCasinoCanvasCache,
  COLORS,
  PANEL_W,
  getCasinoCanvasCacheStats,
};
