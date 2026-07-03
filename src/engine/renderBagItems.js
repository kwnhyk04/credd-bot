'use strict';

/**
 * renderBagItems.js — canvas-rendered boxed item rows (OwO-checklist style)
 * for `crd bag chests`: one rounded dark box per item with the item's emoji
 * icon, bold name, the open command in smaller muted text, and the count
 * right-aligned.
 *
 * Emoji icons are downloaded ONCE from the Discord CDN
 * (https://cdn.discordapp.com/emojis/<id>.png?size=64 — ids from
 * game_items.txt via the emojis util) and cached to disk at
 * assets/cache/emojis/<name>.png, then memoized in-process. Renders never
 * fetch in steady state; the row image itself is re-rendered per invocation
 * (cheap).
 */

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const { emoji } = require('../utils/emojis');
const { assetSource, isRemoteSource, loadAssetImage: loadAssetImageSource } = require('../utils/assets');

const ROOT = path.join(__dirname, '..', '..');
const CACHE_DIR = path.join(ROOT, 'assets', 'cache', 'emojis');

// Bundled font — the host may have no system fonts at all. Regular + Bold
// registered under one family so 'bold …' resolves correctly.
const FONT_FAMILY = 'DejaVu Sans';
for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
  try {
    GlobalFonts.registerFromPath(path.join(ROOT, 'assets', 'fonts', file), FONT_FAMILY);
  } catch (err) {
    console.error(`[renderBagItems] font ${file} failed to register:`, err.message);
  }
}

// Layout
const W = 460;
const ROW_H = 48;
const GAP = 8;          // gap between boxes
const PAD = 10;         // canvas padding
const RADIUS = 10;      // box corner radius
const ICON = 28;        // icon edge length

// Colors (near Discord dark)
const BG = '#1E1F22';
const BOX = '#26272D';
const NAME_COLOR = '#FFFFFF';
const CMD_COLOR = '#8E919A';

// Typography (bundled DejaVu Sans)
const NAME_FONT = `bold 15px "${FONT_FAMILY}"`;
const COUNT_FONT = `15px "${FONT_FAMILY}"`;
const CMD_FONT = `11px "${FONT_FAMILY}"`;

// emojiName → loaded Image (successes only, so transient failures retry later)
const iconCache = new Map();
const localIconCache = new Map();

// '<:silver_chest:1514006354027741184>' → '1514006354027741184'
function emojiIdOf(name) {
  const m = emoji(name).match(/:(\d+)>$/);
  return m ? m[1] : null;
}

/** Disk-cached CDN icon. Returns a canvas Image or null (row renders without icon). */
async function getEmojiIcon(name) {
  if (iconCache.has(name)) return iconCache.get(name);
  try {
    const file = path.join(CACHE_DIR, `${name}.png`);
    if (!fs.existsSync(file)) {
      const id = emojiIdOf(name);
      if (!id) return null;
      const res = await fetch(`https://cdn.discordapp.com/emojis/${id}.png?size=64`);
      if (!res.ok) return null;
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    const img = await loadImage(file);
    iconCache.set(name, img);
    return img;
  } catch (err) {
    console.error(`[renderBagItems] icon '${name}' unavailable:`, err.message);
    return null;
  }
}

/** Disk-cached Twemoji (Discord's default-emoji art) by hex codepoint. Returns
 *  a canvas Image or null. Used for items with no custom emoji (weapons/armors). */
async function getUnicodeIcon(hex) {
  const key = `u${hex}`;
  if (iconCache.has(key)) return iconCache.get(key);
  try {
    const file = path.join(CACHE_DIR, `${key}.png`);
    if (!fs.existsSync(file)) {
      const res = await fetch(`https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${hex}.png`);
      if (!res.ok) return null;
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    const img = await loadImage(file);
    iconCache.set(key, img);
    return img;
  } catch (err) {
    console.error(`[renderBagItems] twemoji '${hex}' unavailable:`, err.message);
    return null;
  }
}

async function loadAssetImage(source) {
  return loadAssetImageSource(loadImage, source);
}

async function getLocalIcon(filePath) {
  const resolved = assetSource(filePath);
  let mtimeMs = 'remote';
  if (!isRemoteSource(resolved)) {
    try {
      mtimeMs = fs.statSync(resolved).mtimeMs;
    } catch {
      return null;
    }
  }

  const cached = localIconCache.get(resolved);
  if (cached && cached.mtimeMs === mtimeMs) return cached.image;

  try {
    const image = await loadAssetImage(resolved);
    localIconCache.set(resolved, { mtimeMs, image });
    return image;
  } catch {
    localIconCache.set(resolved, { mtimeMs, image: null });
    return null;
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/**
 * @param {Array<{emojiName: string, name: string, count: number, cmd: string}>} items
 * @returns {Promise<Buffer>} PNG
 */
async function renderBagItemsImage(items) {
  const H = PAD * 2 + items.length * ROW_H + (items.length - 1) * GAP;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const y = PAD + i * (ROW_H + GAP);

    roundRectPath(ctx, PAD, y, W - PAD * 2, ROW_H, RADIUS);
    ctx.fillStyle = BOX;
    ctx.fill();

    const midY = y + ROW_H / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // Optional leading id label (essence shop: `1` `2` …) before the icon.
    let leftX = PAD + 12;
    if (item.idLabel != null) {
      ctx.font = NAME_FONT;
      ctx.fillStyle = CMD_COLOR;
      ctx.fillText(String(item.idLabel), leftX, midY);
      leftX += ctx.measureText(String(item.idLabel)).width + 12;
    }

    // Icon: a local iconPath (assets/items/...) wins over the CDN emoji; a unicode
    // `glyph` (e.g. ⚔️ / 🛡️) is the last-resort fallback drawn as text.
    let icon = null;
    if (item.iconPath) icon = await getLocalIcon(item.iconPath);
    if (!icon && item.emojiName) icon = await getEmojiIcon(item.emojiName);
    if (!icon && item.twemoji) icon = await getUnicodeIcon(item.twemoji);
    if (icon) {
      ctx.drawImage(icon, leftX, midY - ICON / 2, ICON, ICON);
    } else if (item.glyph) {
      ctx.font = `${ICON - 4}px "${FONT_FAMILY}"`;
      ctx.fillStyle = NAME_COLOR;
      ctx.fillText(item.glyph, leftX, midY);
    }

    // Bold name, then the open command in smaller muted text.
    const nameX = leftX + ICON + 10;
    ctx.font = NAME_FONT;
    ctx.fillStyle = NAME_COLOR;
    ctx.fillText(item.name, nameX, midY);
    const nameW = ctx.measureText(item.name).width;
    let cmdEnd = nameX + nameW;
    if (item.cmd) {
      ctx.font = CMD_FONT;
      ctx.fillStyle = CMD_COLOR;
      ctx.fillText(item.cmd, nameX + nameW + 12, midY);
      cmdEnd = nameX + nameW + 12 + ctx.measureText(item.cmd).width;
    }

    // Right side, in priority: rightSegments (text + inline emoji icons, FIXED
    // font) → `right` string (auto-shrunk) → numeric count.
    ctx.fillStyle = NAME_COLOR;
    if (Array.isArray(item.rightSegments)) {
      const SEG_FONT = `15px "${FONT_FAMILY}"`;
      const SEG_ICON = 20;
      ctx.font = SEG_FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      // Resolve icons + measure total width.
      let total = 0;
      const parts = [];
      for (const seg of item.rightSegments) {
        if (seg.text != null) {
          parts.push({ text: seg.text, w: ctx.measureText(seg.text).width });
          total += parts[parts.length - 1].w;
        } else {
          let im = null;
          if (seg.iconPath) im = await getLocalIcon(seg.iconPath);
          if (!im && seg.emojiName) im = await getEmojiIcon(seg.emojiName);
          if (!im && seg.twemoji) im = await getUnicodeIcon(seg.twemoji);
          parts.push({ img: im, w: im ? SEG_ICON + 2 : 0 });
          total += parts[parts.length - 1].w;
        }
      }
      let sx = W - PAD - 14 - total;
      for (const p of parts) {
        if (p.img) { ctx.drawImage(p.img, sx, midY - SEG_ICON / 2, SEG_ICON, SEG_ICON); sx += p.w; }
        else if (p.text != null) { ctx.fillText(p.text, sx, midY); sx += p.w; }
      }
      ctx.textAlign = 'left';
    } else if (item.right != null) {
      ctx.textAlign = 'right';
      const avail = (W - PAD - 14) - (cmdEnd + 14);
      let px = 15;
      ctx.font = `${px}px "${FONT_FAMILY}"`;
      while (px > 9 && ctx.measureText(String(item.right)).width > avail) {
        px -= 1; ctx.font = `${px}px "${FONT_FAMILY}"`;
      }
      ctx.fillText(String(item.right), W - PAD - 14, midY);
    } else {
      ctx.textAlign = 'right';
      ctx.font = COUNT_FONT;
      ctx.fillText(String(item.count), W - PAD - 14, midY);
    }
    ctx.textAlign = 'left';
  }

  ctx.textBaseline = 'alphabetic';
  return canvas.toBuffer('image/png');
}

// getEmojiIcon shared with renderSummon (badge essence icons use the same cache).
module.exports = { renderBagItemsImage, getEmojiIcon, FONT_FAMILY };
