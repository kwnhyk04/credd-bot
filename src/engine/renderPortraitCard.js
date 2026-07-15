'use strict';

/**
 * renderPortraitCard.js — a single composited card: portrait image on the LEFT
 * (3:4 box, fit whole / never cropped) and text on the RIGHT (title, subtitle,
 * sections). Used by `crd weapon info`, `crd deity info`, and the create-character
 * class preview so the artwork sits flush-left with no wide blank letterbox canvas.
 *
 * Same font/palette conventions as the other canvas renderers (shared FONT_FAMILY).
 */

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { encodeCanvas, releaseCanvas } = require('../utils/canvasEncode');
const path = require('path');
const { FONT_FAMILY } = require('./renderBagItems');
const { assetSource, loadAssetImage: loadAssetImageSource } = require('../utils/assets');

const ROOT = path.join(__dirname, '..', '..');
for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
  try { GlobalFonts.registerFromPath(path.join(ROOT, 'assets', 'fonts', file), FONT_FAMILY); }
  catch { /* already registered */ }
}

/* ── Layout ─────────────────────────────────────────────────────────────── */
const W = 760;
const PAD = 24;
const PW = 270;                 // portrait box width
const PH = Math.round(PW * 4 / 3); // 3:4 portrait box height (360)
const GAP = 24;
const RX = PAD + PW + GAP;       // right column x
const RW = W - RX - PAD;         // right column width
const RADIUS = 14;

/* ── Colors ─────────────────────────────────────────────────────────────── */
const BG = '#1E1F22';
const PANEL = '#26272D';
const TITLE_COLOR = '#FFFFFF';
const BODY_COLOR = '#D4D7DC';
const DIM_COLOR = '#9aa0a8';
const SLOT_BG = '#2F313A';
const SLOT_EMPTY_BORDER = '#3a3d46';
// Rune tier → border color (the slot border indicates the socketed rune's tier).
const TIER_COLOR = {
  Common: '#95a5a6', Rare: '#3498db', Mythic: '#9b59b6', Legendary: '#fbbf24', Supreme: '#e74c3c',
};

/* ── Socket panel layout (rune slots in the right column) ─────────────────── */
const SOCK_BOX = 72;        // target slot box edge
const SOCK_GAP = 10;        // gap between slots
const SOCK_HEAD = 24;       // "Sockets" heading band
const SOCK_VALUE_H = 18;    // value strip under the rune image
const SOCK_ROW_GAP = 8;     // gap between wrapped rows

/** Layout for n socket boxes within the right column (wraps to multiple rows). */
function sockPanel(n) {
  if (!n) return { rows: 0, perRow: 0, box: 0, h: 0 };
  const perRow = Math.max(1, Math.floor((RW + SOCK_GAP) / (SOCK_BOX + SOCK_GAP)));
  const box = Math.min(SOCK_BOX, Math.floor((RW - (Math.min(n, perRow) - 1) * SOCK_GAP) / Math.min(n, perRow)));
  const rows = Math.ceil(n / perRow);
  const h = SOCK_HEAD + rows * (box + SOCK_VALUE_H + SOCK_ROW_GAP);
  return { rows, perRow, box, h };
}

/** Shrink the font until `text` fits `maxW`; returns the chosen px size. */
function fitFont(ctx, text, startPx, maxW, bold = false) {
  let px = startPx;
  while (px > 8) {
    ctx.font = F(px, bold);
    if (ctx.measureText(text).width <= maxW) break;
    px -= 1;
  }
  return px;
}

const F = (px, bold = false) => `${bold ? 'bold ' : ''}${px}px "${FONT_FAMILY}"`;

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function loadLocalImage(filePath) {
  if (Array.isArray(filePath)) {
    for (const candidate of filePath) {
      const image = await loadLocalImage(candidate);
      if (image) return image;
    }
    return null;
  }

  const resolved = assetSource(filePath);
  try {
    return await loadAssetImageSource(loadImage, resolved);
  } catch {
    return null;
  }
}

/** Word-wrap (honoring explicit \n) to fit maxW at the current ctx.font. */
function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (para === '') { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Measure the right-column text block height for the given sections (so the card
 * can be sized to content). Mutates nothing; uses the shared font sizes.
 */
function measureRight(ctx, title, subtitle, sections) {
  let h = 0;
  ctx.font = F(27, true);
  h += wrapLines(ctx, title, RW).length * 32;
  if (subtitle) { ctx.font = F(15, true); h += 6 + 20; }
  h += 14;
  for (const s of sections) {
    if (s.heading) { ctx.font = F(15, true); h += wrapLines(ctx, s.heading, RW).length * 21; }
    if (s.body) { ctx.font = F(14); h += wrapLines(ctx, s.body, RW).length * 20; }
    h += 12;
  }
  return h;
}

/** Draw the portrait, fully contained (no crop) and centered in the 3:4 box. */
function drawPortrait(ctx, img, x, y, accent) {
  roundRectPath(ctx, x, y, PW, PH, RADIUS);
  ctx.fillStyle = PANEL;
  ctx.fill();
  if (img) {
    const scale = Math.min(PW / img.width, PH / img.height); // contain — never crop
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = x + (PW - dw) / 2;
    const dy = y + (PH - dh) / 2;
    ctx.save();
    roundRectPath(ctx, x, y, PW, PH, RADIUS);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = DIM_COLOR;
    ctx.font = F(14);
    ctx.textAlign = 'center';
    ctx.fillText('No artwork', x + PW / 2, y + PH / 2);
    ctx.textAlign = 'left';
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  roundRectPath(ctx, x, y, PW, PH, RADIUS);
  ctx.stroke();
}

/**
 * @param {object} d
 *   imagePath: string|null    — portrait artwork (PNG/JPG)
 *   accent:    string         — hex border/title accent
 *   title:     string         — big name
 *   subtitle:  string|null    — tier / level line under the title (accent colored)
 *   sections:  Array<{ heading?: string, body?: string }>
 * @returns {Promise<Buffer>} PNG
 */
async function renderPortraitCard(d) {
  let img = null;
  if (d.imagePath) {
    img = await loadLocalImage(d.imagePath);
  }
  const accent = d.accent || '#9b59b6';

  // Preload socket rune images (filled slots only). [v5 Phase 2] rune slot panel.
  const sockets = Array.isArray(d.sockets) ? d.sockets : [];
  const sockImgs = await Promise.all(sockets.map((s) =>
    s.imagePath ? loadLocalImage(s.imagePath) : Promise.resolve(null)));
  const panel = sockPanel(sockets.length);

  // Height: tallest of the portrait and the text block (+ socket panel), plus padding.
  const probeCanvas = createCanvas(10, 10);
  const probe = probeCanvas.getContext('2d');
  let textH;
  try {
    textH = measureRight(probe, d.title, d.subtitle, d.sections || []) + (panel.h ? panel.h + 8 : 0);
  } finally {
    releaseCanvas(probeCanvas);
  }
  const H = Math.max(PH + PAD * 2, textH + PAD * 2);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  drawPortrait(ctx, img, PAD, PAD, accent);

  // Right column: title → subtitle → sections.
  let y = PAD + 28;
  ctx.font = F(27, true);
  ctx.fillStyle = TITLE_COLOR;
  for (const line of wrapLines(ctx, d.title, RW)) { ctx.fillText(line, RX, y); y += 32; }

  if (d.subtitle) {
    y += 2;
    ctx.font = F(15, true);
    ctx.fillStyle = accent;
    ctx.fillText(d.subtitle, RX, y);
    y += 20;
  }
  y += 12;

  for (const s of (d.sections || [])) {
    if (s.heading) {
      ctx.font = F(15, true);
      ctx.fillStyle = TITLE_COLOR;
      for (const line of wrapLines(ctx, s.heading, RW)) { ctx.fillText(line, RX, y); y += 21; }
    }
    if (s.body) {
      ctx.font = F(14);
      ctx.fillStyle = s.dim ? DIM_COLOR : BODY_COLOR;
      for (const line of wrapLines(ctx, s.body, RW)) { ctx.fillText(line, RX, y); y += 20; }
    }
    y += 12;
  }

  // ── Socket panel — boxed rune slots, centered, auto-sizing (Phase 2) ──────
  if (panel.h) {
    ctx.font = F(15, true);
    ctx.fillStyle = TITLE_COLOR;
    ctx.textAlign = 'left';
    ctx.fillText('Runes', RX, y + 4);
    y += SOCK_HEAD;

    const box = panel.box;
    for (let i = 0; i < sockets.length; i++) {
      const rowIdx = Math.floor(i / panel.perRow);
      const colIdx = i % panel.perRow;
      const bx = RX + colIdx * (box + SOCK_GAP);           // left-aligned under the "Runes" heading
      const by = y + rowIdx * (box + SOCK_VALUE_H + SOCK_ROW_GAP);

      const slot = sockets[i];
      const filled = !!slot.imagePath || (slot.label != null && slot.label !== '');
      // [v5 #9] border color = the socketed rune's TIER (empty = dim).
      const border = filled ? (TIER_COLOR[slot.tier] || accent) : SLOT_EMPTY_BORDER;
      roundRectPath(ctx, bx, by, box, box, 12);
      ctx.fillStyle = SLOT_BG;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = border;
      roundRectPath(ctx, bx, by, box, box, 12);
      ctx.stroke();

      const img = sockImgs[i];
      if (img) {
        const inner = box - 16;
        const scale = Math.min(inner / img.width, inner / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        ctx.drawImage(img, bx + (box - dw) / 2, by + (box - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = DIM_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = F(13);
        ctx.fillText(filled ? '◆' : '—', bx + box / 2, by + box / 2);
        ctx.textBaseline = 'alphabetic';
      }

      // Caption under the box: filled runes show NO name (per request); empty slots read "Empty".
      if (!filled) {
        ctx.fillStyle = DIM_COLOR;
        ctx.font = F(11);
        ctx.textAlign = 'center';
        ctx.fillText('Empty', bx + box / 2, by + box + 12);
      }
      ctx.textAlign = 'left';
    }
  }

  return encodeCanvas(canvas);
}

module.exports = { renderPortraitCard };
