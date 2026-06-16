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
 * A centered row of small cards — [v4.7] just the card art, no rank-text overlay (the PNG
 * assets already show their ranks, even compressed). @param {string[]} paths
 */
async function cardStrip(paths, { cardW = 64, cardH = 90, gap = 12, panelW = PANEL_W, padY = 10 } = {}) {
  const imgs = await Promise.all(paths.map(loadCached));
  const canvas = createCanvas(panelW, cardH + padY * 2);
  const ctx = canvas.getContext('2d');
  const total = paths.length * cardW + (paths.length - 1) * gap;
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
