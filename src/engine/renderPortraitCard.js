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
const path = require('path');
const { FONT_FAMILY } = require('./renderBagItems');

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
    try { img = await loadImage(d.imagePath); } catch { img = null; }
  }
  const accent = d.accent || '#9b59b6';

  // Height: tallest of the portrait and the text block, plus padding.
  const probe = createCanvas(10, 10).getContext('2d');
  const textH = measureRight(probe, d.title, d.subtitle, d.sections || []);
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

  return canvas.toBuffer('image/png');
}

module.exports = { renderPortraitCard };
