'use strict';

/**
 * weaponResultRenderer.js — chest-result weapon grid (summon-style canvas):
 * dark panel, tier-colored card per weapon, weapon sprite centered, and small
 * readable text baked INTO the image: unique weapon id, name, tier, stats.
 *
 * Canvas: @napi-rs/canvas (project standard). The bundled DejaVu Sans family
 * is registered here (host may have no system fonts) so the tier icons
 * (◆ ❖ ★ ✦) never render as tofu boxes on Linux.
 *
 * Sprites live in assets/weapons as <registry_emoji_name>.jpg|png — resolved
 * through utils/emojis (same lookup as `crd weapon info`), falling back to the
 * name-derived slug, then to a '?' placeholder.
 *
 * Centering rule: the canvas is ALWAYS the full 5-column grid width and every
 * row centers its cards, so 1/2/3-card renders (e.g. a supreme chest single)
 * appear centered in Discord instead of left-aligned against a narrow image.
 */

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');
const { resolveName } = require('../utils/emojis');
const { capitalizeLower } = require('../utils/textFormat');

const ROOT = path.join(__dirname, '..', '..');
const WEAPONS_DIR = path.join(ROOT, 'assets', 'weapons');

const FONT_FAMILY = 'DejaVu Sans';
for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
  try {
    GlobalFonts.registerFromPath(path.join(ROOT, 'assets', 'fonts', file), FONT_FAMILY);
  } catch (err) {
    console.error(`[weaponResultRenderer] font ${file} failed to register:`, err.message);
  }
}

// ---- tier visual config (project weapon tiers, colors match open/weapon.js) ----
const TIERS = {
  common:    { color: '#95a5a6', glow: 0,  icon: '•' },
  rare:      { color: '#3498db', glow: 6,  icon: '◆' },
  mythic:    { color: '#9b59b6', glow: 12, icon: '❖' },
  legendary: { color: '#fbbf24', glow: 16, icon: '★' },
  supreme:   { color: '#e74c3c', glow: 20, icon: '✦' },
};

// ---- layout ----
const CARD_W = 168;
const CARD_H = 224;
const GAP = 14;
const PAD = 22;
const COLS_MAX = 5;
const SPRITE = 88; // weapon sprite box
// Full 5-column width — every render uses it so narrow results stay centered
// in the Discord embed (≥ ~640px rule).
const GRID_W = PAD * 2 + COLS_MAX * CARD_W + (COLS_MAX - 1) * GAP; // 940
const spriteCache = new Map();

function tierOf(item) {
  return TIERS[(item.tier || 'common').toLowerCase()] || TIERS.common;
}

/**
 * Sprite path for a weapon display name. Filenames equal the registry emoji
 * names (including their typos, e.g. dipylon_shied.jpg) — resolve through the
 * registry first, then the name-derived slug. null = no art on disk.
 */
function weaponImagePath(name) {
  const derived = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const slugs = [resolveName(name), derived].filter(Boolean);
  for (const slug of slugs) {
    for (const ext of ['png', 'jpg']) {
      const p = path.join(WEAPONS_DIR, `${slug}.${ext}`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
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

function fitText(ctx, text, maxWidth, basePx, weight = 'bold') {
  let px = basePx;
  ctx.font = `${weight} ${px}px "${FONT_FAMILY}"`;
  while (ctx.measureText(text).width > maxWidth && px > 9) {
    px -= 1;
    ctx.font = `${weight} ${px}px "${FONT_FAMILY}"`;
  }
  return px;
}

function statsLine(item) {
  // accepts { stats: { ATK: 40, CRIT: 15 } } or a prebuilt string
  if (typeof item.stats === 'string') return item.stats;
  return Object.entries(item.stats || {})
    .map(([k, v]) => `+${v} ${k}`)
    .join(' · ');
}

async function loadSprite(imgPath) {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(imgPath).mtimeMs;
  } catch {
    return null;
  }

  const cached = spriteCache.get(imgPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.image;

  try {
    const image = await loadImage(imgPath);
    spriteCache.set(imgPath, { mtimeMs, image });
    return image;
  } catch (err) {
    console.error(`[weaponResultRenderer] sprite load failed (${imgPath}):`, err.message);
    spriteCache.set(imgPath, { mtimeMs, image: null });
    return null;
  }
}

async function drawCard(ctx, item, x, y) {
  const t = tierOf(item);

  // card background
  ctx.save();
  roundRect(ctx, x, y, CARD_W, CARD_H, 12);
  const grad = ctx.createLinearGradient(x, y, x, y + CARD_H);
  grad.addColorStop(0, '#221534');
  grad.addColorStop(1, '#170d26');
  ctx.fillStyle = grad;
  if (t.glow) {
    ctx.shadowColor = t.color;
    ctx.shadowBlur = t.glow;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  roundRect(ctx, x, y, CARD_W, CARD_H, 12);
  ctx.strokeStyle = t.color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  let cy = y + 10;

  // unique weapon id — small, top-left corner
  ctx.font = `10px "${FONT_FAMILY}"`;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textAlign = 'left';
  ctx.fillText(`#${item.id}`, x + 9, cy + 8);
  cy += 16;

  // weapon/rune sprite (rounded-clipped). An explicit imagePath (e.g. a rune at
  // assets/items/runes/<key>_rune.png) overrides the weapon-name art lookup.
  const imgPath = item.imagePath || weaponImagePath(item.name);
  let drawn = false;
  if (imgPath) {
    const img = await loadSprite(imgPath);
    if (img) {
      const scale = Math.min(SPRITE / img.width, SPRITE / img.height);
      const w = img.width * scale, h = img.height * scale;
      const dx = x + (CARD_W - w) / 2;
      const dy = cy + (SPRITE - h) / 2;
      ctx.save();
      roundRect(ctx, dx, dy, w, h, 8);
      ctx.clip();
      ctx.drawImage(img, dx, dy, w, h);
      ctx.restore();
      drawn = true;
    }
  }
  if (!drawn) {
    ctx.font = `34px "${FONT_FAMILY}"`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText('?', x + CARD_W / 2, cy + SPRITE / 2 + 12);
  }
  cy += SPRITE + 16;

  ctx.textAlign = 'center';
  const cx = x + CARD_W / 2;
  const maxW = CARD_W - 18;

  // name (auto-shrinks to fit)
  fitText(ctx, item.name, maxW, 14);
  ctx.fillStyle = t.color;
  ctx.fillText(item.name, cx, cy);
  cy += 18;

  // tier
  ctx.font = `bold 11px "${FONT_FAMILY}"`;
  ctx.fillStyle = t.color;
  ctx.fillText(`${t.icon} ${capitalizeLower(item.tier)}`, cx, cy);
  cy += 18;

  // stats — small but readable, wraps to 2 lines if needed
  const line = statsLine(item);
  ctx.fillStyle = '#e7e2f1';
  const px = fitText(ctx, line, maxW, 12, 'normal');
  if (px <= 9 && line.includes(' · ')) {
    const parts = line.split(' · ');
    const mid = Math.ceil(parts.length / 2);
    const l1 = parts.slice(0, mid).join(' · ');
    const l2 = parts.slice(mid).join(' · ');
    fitText(ctx, l1.length > l2.length ? l1 : l2, maxW, 12, 'normal');
    ctx.fillText(l1, cx, cy);
    ctx.fillText(l2, cx, cy + 14);
    cy += 14;
  } else {
    ctx.fillText(line, cx, cy);
  }

  // [v5 #7] socket count — its own centered line under the stats.
  if (item.sockets != null) {
    cy += 16;
    ctx.font = `bold 11px "${FONT_FAMILY}"`;
    ctx.fillStyle = '#c9b8e8';
    ctx.textAlign = 'center';
    ctx.fillText(`◇ ${item.sockets} Rune slot${item.sockets === 1 ? '' : 's'}`, cx, cy);
  }
}

/**
 * Render the result grid.
 * @param {Array<{id:string|number, name:string, tier:string, stats:object|string}>} items
 * @returns {Promise<Buffer>} PNG buffer for AttachmentBuilder
 */
async function renderWeaponResults(items) {
  const rows = Math.ceil(items.length / COLS_MAX);
  const H = PAD * 2 + rows * CARD_H + (rows - 1) * GAP;

  const canvas = createCanvas(GRID_W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#15101f';
  ctx.fillRect(0, 0, GRID_W, H);

  for (let r = 0; r < rows; r++) {
    const rowItems = items.slice(r * COLS_MAX, (r + 1) * COLS_MAX);
    const rowW = rowItems.length * CARD_W + (rowItems.length - 1) * GAP;
    const startX = Math.round((GRID_W - rowW) / 2); // center partial rows
    const y = PAD + r * (CARD_H + GAP);
    for (let c = 0; c < rowItems.length; c++) {
      await drawCard(ctx, rowItems[c], startX + c * (CARD_W + GAP), y);
    }
  }
  return canvas.toBuffer('image/png');
}

module.exports = { renderWeaponResults, TIERS, weaponImagePath };
