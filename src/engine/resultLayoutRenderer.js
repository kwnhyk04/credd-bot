'use strict';

/**
 * Layout-driven renderer for equipped battle-result skins (victory / defeated).
 *
 * A result skin is a complete background PNG with a colocated
 * `<skin>.layout.json`. STRICT outcome rule: a WIN renders the `victory` canvas,
 * a LOSS renders the `defeated` canvas — they are separate art with separate
 * layouts, never cross-rendered (the variant is chosen by the caller via
 * resolveSkin, and this module only paints whichever canvas it is handed).
 *
 * The JSON owns the title/subtitle positions and the reward PANEL rect; the
 * renderer CENTERS the reward rows inside that panel and auto-scales the icon
 * and font sizes to the panel height (overridable per-skin). Missing/invalid
 * skins return null so battleRender falls back to its generic rewards strip.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..', '..');
const FONT_FALLBACK = 'DejaVu Sans';
for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
  try {
    GlobalFonts.registerFromPath(path.join(ROOT, 'assets', 'fonts', file), FONT_FALLBACK);
  } catch {
    // battleRender registers the same fonts at boot; duplicate registration is harmless.
  }
}

const skinCache = new Map(); // skin path -> { signature, promise }
const warned = new Set();

function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function layoutPathFor(skinPath) {
  return skinPath.replace(/\.[^.]+$/, '.layout.json');
}

function isRect(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) &&
    Number.isFinite(value.w) && Number.isFinite(value.h);
}

function validateResultLayout(layout) {
  // Only the reward PANEL is required — the renderer draws nothing but rewards
  // (the art already carries the VICTORY/DEFEATED emblem).
  return !!(layout && layout.canvas &&
    Number.isFinite(layout.canvas.w) && Number.isFinite(layout.canvas.h) &&
    isRect(layout.panel));
}

/** Load and cache a result skin image together with its own colocated layout. */
async function loadResultSkin(skinPath) {
  if (!skinPath) return null;
  const configPath = layoutPathFor(skinPath);
  let signature;
  try {
    signature = `${fs.statSync(skinPath).mtimeMs}:${fs.statSync(configPath).mtimeMs}`;
  } catch {
    warnOnce(skinPath, `[resultLayout] skin or layout missing for ${path.basename(skinPath)}; using default rewards strip.`);
    return null;
  }

  const cached = skinCache.get(skinPath);
  if (cached && cached.signature === signature) return cached.promise;

  const promise = (async () => {
    const layout = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!validateResultLayout(layout)) {
      warnOnce(configPath, `[resultLayout] invalid layout ${configPath}; using default rewards strip.`);
      return null;
    }
    const image = await loadImage(skinPath);
    return { image, layout, skinPath, configPath };
  })().catch((err) => {
    warnOnce(configPath, `[resultLayout] failed to load ${path.basename(skinPath)}: ${err.message}; using default rewards strip.`);
    return null;
  });

  skinCache.set(skinPath, { signature, promise });
  return promise;
}

function fontOf(family, weight, size) {
  return `${weight === 'bold' ? 'bold ' : ''}${Math.max(10, Math.round(Number(size) || 16))}px "${family || FONT_FALLBACK}"`;
}

/** The reward entries for an outcome — one centered row each. */
function buildEntries(won, rewards) {
  if (!rewards) return [];
  const entries = [];
  if (won) {
    entries.push({ icon: 'Credux Coin', value: `+${Number(rewards.credux || 0).toLocaleString()}`, label: 'Credux', glyph: '◉', glyphColor: '#f0b232' });
    entries.push({ icon: 'Combat Exp', value: `+${Number(rewards.exp || 0).toLocaleString()}`, label: 'EXP', glyph: '✦', glyphColor: '#f0b232' });
    if (Number(rewards.shards) > 0) {
      entries.push({ icon: 'Belief Shards', value: `+${rewards.shards}`, label: 'Belief Shards', glyph: '❖', glyphColor: '#b57edc' });
    }
    if (rewards.chestLabel) {
      entries.push({ icon: rewards.chestLabel, value: '×1', label: rewards.chestLabel, glyph: '◆', glyphColor: '#9aa0a8' });
    }
  } else {
    entries.push({ icon: 'Combat Exp', value: `+${Number(rewards.exp || 0).toLocaleString()}`, label: 'EXP', glyph: '✦', glyphColor: '#f0b232' });
  }
  return entries;
}

function fillRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(Number(r) || 0, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
}

/**
 * Render the result canvas with rewards centered in the configured panel.
 * @param {object} sim      resolveBattle output (sim.winner / sim.b.name)
 * @param {object|null} rewards   commitRewards summary, or null (outcome-only)
 * @param {object} skin     loadResultSkin output
 * @param {object} opts
 * @param {(name:string)=>Promise<Image|null>} opts.loadIcon  custom-emoji loader
 * @returns {Promise<Buffer|null>}
 */
async function renderResultPanel(sim, rewards, skin, { loadIcon } = {}) {
  if (!skin || !skin.image || !validateResultLayout(skin.layout)) return null;
  const layout = skin.layout;
  const won = sim.winner === 'a';
  const accent = layout.theme_accent || '#f0b232';
  const panel = layout.panel;

  const canvas = createCanvas(layout.canvas.w, layout.canvas.h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(skin.image, 0, 0, layout.canvas.w, layout.canvas.h);

  // optional reward backing plate (helps legibility on busy art)
  if (isRect(layout.plate)) {
    ctx.fillStyle = layout.plate.fill || 'rgba(0,0,0,0.42)';
    if (layout.plate.radius) fillRoundRect(ctx, layout.plate.x, layout.plate.y, layout.plate.w, layout.plate.h, layout.plate.radius);
    else ctx.fillRect(layout.plate.x, layout.plate.y, layout.plate.w, layout.plate.h);
  }

  // Draw ONLY the rewards — no VICTORY/DEFEATED word and no "<mob> defeated!"
  // line (the result art already carries those). The layout's
  // `rewards.orientation` ("horizontal" | "vertical") decides the arrangement
  // per canvas; sizes auto-scale to the panel.
  const entries = buildEntries(won, rewards);
  if (!entries.length) return canvas.toBuffer('image/png');
  const rw = layout.rewards || {};
  const cx = Number.isFinite(rw.center_x) ? rw.center_x : panel.x + panel.w / 2;
  const icons = await Promise.all(entries.map((e) => (loadIcon ? loadIcon(e.icon).catch(() => null) : Promise.resolve(null))));
  const levelUp = !!(won && rewards && rewards.leveledUp);
  // Default to one centered left→right row (like the default rewards strip);
  // only an explicit orientation:'vertical' stacks them.
  const horizontal = rw.orientation !== 'vertical';

  // One reward entry = icon + value + label, left-anchored at (x, y) baseline-middle.
  const entryWidth = (e, iconSize, valueSize, labelSize) => {
    const gap = Math.round(iconSize * 0.28);
    ctx.font = fontOf(rw.font, 'bold', valueSize);
    const vw = ctx.measureText(e.value).width;
    ctx.font = fontOf(rw.font, 'normal', labelSize);
    const lw = ctx.measureText(`  ${e.label}`).width;
    return iconSize + gap + vw + lw;
  };
  const drawEntry = (e, img, x, y, iconSize, valueSize, labelSize) => {
    const gap = Math.round(iconSize * 0.28);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (img) {
      ctx.drawImage(img, x, Math.round(y - iconSize / 2), iconSize, iconSize);
    } else {
      ctx.font = fontOf(rw.font, 'bold', iconSize);
      ctx.fillStyle = e.glyphColor || accent;
      ctx.fillText(e.glyph || '◆', x, y);
    }
    let xp = x + iconSize + gap;
    ctx.font = fontOf(rw.font, 'bold', valueSize);
    ctx.fillStyle = rw.value_color || accent;
    ctx.fillText(e.value, xp, y);
    xp += ctx.measureText(e.value).width;
    ctx.font = fontOf(rw.font, 'normal', labelSize);
    ctx.fillStyle = rw.label_color || '#D7DBE2';
    ctx.fillText(`  ${e.label}`, xp, y);
  };
  const drawLevelUp = (y, size) => {
    ctx.font = fontOf(rw.font, 'bold', size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rw.levelup_color || '#f0b232';
    ctx.fillText(`LEVEL UP!   ${rewards.levelFrom} → ${rewards.levelTo}`, cx, y);
  };

  // Reserve a strip at the top of the panel so the first reward clears the art's
  // "Rewards Obtained" ribbon (the detected zone starts at that ribbon). Rewards
  // center within the area below it. Tunable per-layout via rewards.top_reserve.
  const reserve = Math.round(panel.h * (Number.isFinite(rw.top_reserve) ? rw.top_reserve : 0.18));
  const availY = panel.y + reserve;
  const availH = Math.max(80, panel.h - reserve);

  if (horizontal) {
    // single centered row; scale from available height, then shrink to panel width
    let iconSize = Math.round(rw.icon_size || Math.max(36, Math.min(120, availH * (levelUp ? 0.40 : 0.56))));
    let valueSize = Math.round(rw.value_size || iconSize * 0.58);
    let labelSize = Math.round(rw.label_size || iconSize * 0.46);
    const sep = () => Math.round(iconSize * 0.7);
    const totalW = () => entries.reduce((s, e) => s + entryWidth(e, iconSize, valueSize, labelSize), 0) + sep() * (entries.length - 1);
    const maxW = panel.w * 0.96;
    if (totalW() > maxW) {
      const k = maxW / totalW();
      iconSize = Math.max(18, Math.round(iconSize * k));
      valueSize = Math.max(11, Math.round(valueSize * k));
      labelSize = Math.max(10, Math.round(labelSize * k));
    }
    const cyMid = availY + availH / 2;
    const rowY = levelUp ? Math.round(cyMid - iconSize * 0.7) : Math.round(cyMid);
    let x = Math.round(cx - totalW() / 2);
    for (let i = 0; i < entries.length; i++) {
      drawEntry(entries[i], icons[i], x, rowY, iconSize, valueSize, labelSize);
      x += entryWidth(entries[i], iconSize, valueSize, labelSize) + sep();
    }
    if (levelUp) drawLevelUp(Math.round(rowY + iconSize * 1.15), Math.round(rw.levelup_size || iconSize * 0.6));
  } else {
    // vertical list — each row reads left→right (icon · value · label) and is
    // CENTER-aligned on the panel's center; the block is fit to the available
    // height and vertically centered below the ribbon reserve.
    let iconSize = Math.round(rw.icon_size || Math.max(36, Math.min(104, availH * 0.18)));
    let valueSize = Math.round(rw.value_size || iconSize * 0.62);
    let labelSize = Math.round(rw.label_size || iconSize * 0.5);
    let rowGap = Math.round(rw.row_gap || iconSize * 1.5);
    const rowsTotal = entries.length + (levelUp ? 1 : 0);
    if (rowsTotal * rowGap > availH) {
      const k = availH / (rowsTotal * rowGap);
      iconSize = Math.max(22, Math.round(iconSize * k));
      valueSize = Math.max(13, Math.round(valueSize * k));
      labelSize = Math.max(12, Math.round(labelSize * k));
      rowGap = Math.round(rowGap * k);
    }
    let y = Math.round(availY + (availH - rowsTotal * rowGap) / 2 + rowGap / 2);
    for (let i = 0; i < entries.length; i++) {
      const w = entryWidth(entries[i], iconSize, valueSize, labelSize);
      drawEntry(entries[i], icons[i], Math.round(cx - w / 2), y, iconSize, valueSize, labelSize);
      y += rowGap;
    }
    if (levelUp) drawLevelUp(y, Math.round(rw.levelup_size || iconSize * 0.6));
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  layoutPathFor,
  validateResultLayout,
  loadResultSkin,
  renderResultPanel,
};
