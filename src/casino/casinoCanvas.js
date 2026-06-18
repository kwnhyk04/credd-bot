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

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const pool = require('../db/pool');
const { rankLabel, SUIT_LABEL } = require('./cardDeck');

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

const imgCache = new Map();
function loadCached(p) {
  if (!imgCache.has(p)) imgCache.set(p, loadImage(p).catch(() => null));
  return imgCache.get(p);
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
const CARDS_IMG = path.join(ROOT, 'assets', 'casino', 'cards', 'img');
const CARD_CANVAS_DIR = path.join(CARDS_IMG, 'Card Canvas');
const ROYAL_RANKS = new Set(['j', 'q', 'k']);
const CARD_RANK_HEIGHT_FRAC = 0.85 * 0.75;
const CARD_SYMBOL_HEIGHT_FRAC = 0.85;
const CARD_RANK_Y_OFFSET_FRAC = 0.035;
const CARD_SYMBOL_Y_OFFSET_FRAC = -0.04;
const capSuit = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const canvasBgPath = (suit) => path.join(CARD_CANVAS_DIR, `${suit}_canvas.png`);
const numberPngPath = (suit, rank) => path.join(CARDS_IMG, capSuit(suit), `${suit}_${rank}.png`);
const symbolPngPath = (suit) => path.join(CARDS_IMG, `${suit}.png`);
const royalPngPath = (suit, rank) => path.join(CARDS_IMG, `${suit}_royal_${rank}.png`);

// Fire-and-forget dev_logs note for a missing asset, deduped so one bad path logs once.
const loggedMissing = new Set();
function logMissingAsset(p) {
  if (loggedMissing.has(p)) return;
  loggedMissing.add(p);
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

// Opaque content bounding box of an image (CardSizeFix3): the number/symbol PNGs are
// card-sized (e.g. 1024×1536) with the glyph floating in transparent padding, so the
// raw image height is NOT the glyph height. We scan the alpha channel once per image
// (WeakMap-cached) to find the tight box around the visible pixels; scaling THAT to the
// half-height is what actually makes the glyph fill its zone.
const bboxCache = new WeakMap();
function contentBBox(img) {
  const cached = bboxCache.get(img);
  if (cached) return cached;
  const iw = img.width, ih = img.height;
  const cv = createCanvas(iw, ih);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, iw, ih).data;
  let minX = iw, minY = ih, maxX = -1, maxY = -1;
  const ALPHA = 12; // ignore near-transparent fringe
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      if (data[(y * iw + x) * 4 + 3] > ALPHA) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const box = maxX < 0
    ? { sx: 0, sy: 0, sw: iw, sh: ih }                       // fully transparent → use whole image
    : { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
  bboxCache.set(img, box);
  return box;
}

// HEIGHT-DRIVEN sizing (CardSizeFix3): the VISIBLE glyph height is `heightFrac` of the
// card's HALF height; width follows the trimmed-content aspect ratio. Only scaling step
// — no width cap, no min(). The opaque content box is cropped out of the padded source
// so the glyph truly fills its zone. Drawn dead-centre horizontally and vertically
// within its half ('top' | 'bottom'). Logs resolved geometry once per unique card.
function placeFitted(ctx, img, W, H, heightFrac, half, label, yOffsetFrac = 0) {
  const { sx, sy, sw, sh } = contentBBox(img);
  const halfH = H * 0.5;
  const targetH = Math.floor(halfH * heightFrac);
  const scale = targetH / sh;
  const drawW = Math.floor(sw * scale);
  const drawH = targetH;
  const drawX = Math.floor((W - drawW) / 2);
  const baseY = half === 'top'
    ? Math.floor((halfH - drawH) / 2)
    : Math.floor(halfH + (halfH - drawH) / 2);
  const drawY = baseY + Math.floor(H * yOffsetFrac);
  console.log(`[cardFace] ${label} src=${img.width}x${img.height} content=${sw}x${sh} draw=${drawW}x${drawH} @(${drawX},${drawY}) targetH=${targetH} halfH=${Math.floor(halfH)}`);
  ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
}

async function buildCardFace(card) {
  const { suit, rank } = card;
  const bg = await loadCached(canvasBgPath(suit));
  if (!bg) { logMissingAsset(canvasBgPath(suit)); return programmaticFace(card); }

  const numImg = await loadCached(numberPngPath(suit, rank));
  if (!numImg) { logMissingAsset(numberPngPath(suit, rank)); return programmaticFace(card); }

  // Symbol zone: royal face PNG for J/Q/K, else the generic suit symbol. A missing
  // royal degrades to the generic symbol (not a full fallback); a missing symbol
  // forces the programmatic fallback.
  let symImg = null;
  if (ROYAL_RANKS.has(rank)) {
    symImg = await loadCached(royalPngPath(suit, rank));
    if (!symImg) { logMissingAsset(royalPngPath(suit, rank)); symImg = await loadCached(symbolPngPath(suit)); }
  } else {
    symImg = await loadCached(symbolPngPath(suit));
  }
  if (!symImg) { logMissingAsset(symbolPngPath(suit)); return programmaticFace(card); }

  const W = bg.width, H = bg.height;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  console.log(`[cardFace] ${suit} ${rank} card=${W}x${H}`);
  ctx.drawImage(bg, 0, 0, W, H);                              // layer 1: full-card background
  placeFitted(ctx, numImg, W, H, CARD_RANK_HEIGHT_FRAC, 'top', `${suit} ${rank} number`, CARD_RANK_Y_OFFSET_FRAC);
  placeFitted(ctx, symImg, W, H, CARD_SYMBOL_HEIGHT_FRAC, 'bottom', `${suit} ${rank} symbol`, CARD_SYMBOL_Y_OFFSET_FRAC);
  return cv;
}

// Composited card faces are cached by suit_rank (a face is identical every time).
const faceCache = new Map();
function cardFaceCanvas(card) {
  const key = `${card.suit}_${card.rank}`;
  if (!faceCache.has(key)) faceCache.set(key, buildCardFace(card));
  return faceCache.get(key);
}

/** A centered row of small square images (coin / dice / slot faces). */
async function strip(paths, { tile = 92, gap = 16, panelW = PANEL_W, padY = 10 } = {}) {
  const imgs = await Promise.all(paths.map(loadCached));
  const canvas = createCanvas(panelW, tile + padY * 2);
  const ctx = canvas.getContext('2d');
  const total = imgs.length * tile + (imgs.length - 1) * gap;
  let x = (panelW - total) / 2;
  for (const im of imgs) { drawContain(ctx, im, x, padY, tile, tile); x += tile + gap; }
  return canvas.toBuffer('image/png');
}

/**
 * A centered row of small cards. Each entry is either a card object `{suit, rank}` —
 * composited on Canvas from the suit background + number + symbol/royal PNGs
 * (CardRender) — or a path string (the dealer's `card_back.png`, or a fallback).
 * @param {(object|string)[]} entries
 */
async function cardStrip(entries, { cardW = 64, cardH = 90, gap = 12, panelW = PANEL_W, padY = 10 } = {}) {
  const imgs = await Promise.all(entries.map((e) => (typeof e === 'string' ? loadCached(e) : cardFaceCanvas(e))));
  const canvas = createCanvas(panelW, cardH + padY * 2);
  const ctx = canvas.getContext('2d');
  const total = entries.length * cardW + (entries.length - 1) * gap;
  let x = (panelW - total) / 2;
  for (const im of imgs) {
    drawContain(ctx, im, x, padY, cardW, cardH);
    x += cardW + gap;
  }
  return canvas.toBuffer('image/png');
}

/**
 * A small CENTERED text block (verdict + win/lose banner). Each line auto-shrinks to fit the
 * panel width so it never overflows. @param {{text,size?,color?,bold?,gap?}[]} lines
 */
async function resultStrip(lines, { panelW = PANEL_W } = {}) {
  const measure = createCanvas(8, 8).getContext('2d');
  const maxW = panelW - 28;
  const fitted = lines.map((l) => {
    let size = l.size || 11;
    measure.font = `${l.bold ? 'bold ' : ''}${size}px ${FONT}`;
    const w = measure.measureText(l.text).width;
    if (w > maxW) size = Math.max(6, Math.floor(size * maxW / w));
    return { ...l, size };
  });
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
  return canvas.toBuffer('image/png');
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
  return canvas.toBuffer('image/png');
}

module.exports = { strip, cardStrip, resultStrip, crashPanel, COLORS, PANEL_W };
