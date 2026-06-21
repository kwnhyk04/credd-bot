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

function isStyle(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isRect(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) &&
    Number.isFinite(value.w) && Number.isFinite(value.h);
}

function validateResultLayout(layout) {
  return !!(layout && layout.canvas &&
    Number.isFinite(layout.canvas.w) && Number.isFinite(layout.canvas.h) &&
    isRect(layout.panel) && isStyle(layout.title) && isStyle(layout.subtitle));
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

function anchorOf(anchor) {
  return ['left', 'center', 'right'].includes(anchor) ? anchor : 'left';
}

/** Draw a single configured line, shrinking + ellipsizing to max_width. */
function drawFittedText(ctx, rawText, style) {
  const text = String(rawText ?? '');
  const maxWidth = Number(style.max_width) || Infinity;
  let size = Number(style.size) || 16;
  ctx.font = fontOf(style.font, style.weight, size);
  while (size > 10 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = fontOf(style.font, style.weight, size);
  }
  let fitted = text;
  if (ctx.measureText(fitted).width > maxWidth) {
    while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1);
    fitted = `${fitted}…`;
  }
  ctx.textAlign = anchorOf(style.anchor);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = style.color || '#FFFFFF';
  ctx.fillText(fitted, style.x, style.y);
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

  // title + subtitle (win/lose text resolved here; positions are absolute). Both
  // default to drawing nothing when text is blank / disabled, because the result
  // art usually already carries its own VICTORY/DEFEATED + "Rewards" banner.
  const titleText = won ? (layout.title.win_text ?? 'VICTORY') : (layout.title.lose_text ?? 'DEFEATED');
  if (titleText) drawFittedText(ctx, titleText, { ...layout.title, color: layout.title.color || accent });
  if (layout.subtitle.enabled !== false) {
    const subText = won ? `${sim.b.name} defeated!` : `Defeated by ${sim.b.name}…`;
    drawFittedText(ctx, subText, layout.subtitle);
  }

  // ── reward rows: centered in the panel, sizes auto-scaled to panel height ──
  const entries = buildEntries(won, rewards);
  const rw = layout.rewards || {};
  const cx = Number.isFinite(rw.center_x) ? rw.center_x : panel.x + panel.w / 2;
  if (entries.length) {
    const icons = await Promise.all(entries.map((e) => (loadIcon ? loadIcon(e.icon).catch(() => null) : Promise.resolve(null))));
    const levelUp = won && rewards && rewards.leveledUp;

    const iconSize = Math.round(rw.icon_size || Math.max(28, Math.min(72, panel.h * 0.12)));
    const valueSize = Math.round(rw.value_size || iconSize * 0.62);
    const labelSize = Math.round(rw.label_size || iconSize * 0.5);
    const rowGap = Math.round(rw.row_gap || iconSize * 1.55);
    const luSize = Math.round(rw.levelup_size || iconSize * 0.6);

    const blockH = entries.length * rowGap + (levelUp ? rowGap : 0);
    let y = Math.round(panel.y + (panel.h - blockH) / 2 + iconSize / 2);

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const img = icons[i];
      const gap = Math.round(iconSize * 0.28);
      ctx.font = fontOf(rw.font, 'bold', valueSize);
      const valueW = ctx.measureText(e.value).width;
      ctx.font = fontOf(rw.font, 'normal', labelSize);
      const labelW = ctx.measureText(`  ${e.label}`).width;
      const rowW = iconSize + gap + valueW + labelW;
      let x = Math.round(cx - rowW / 2);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (img) {
        ctx.drawImage(img, x, Math.round(y - iconSize / 2), iconSize, iconSize);
      } else {
        ctx.font = fontOf(rw.font, 'bold', iconSize);
        ctx.fillStyle = e.glyphColor || accent;
        ctx.fillText(e.glyph || '◆', x, y);
      }
      x += iconSize + gap;
      ctx.font = fontOf(rw.font, 'bold', valueSize);
      ctx.fillStyle = rw.value_color || accent;
      ctx.fillText(e.value, x, y);
      x += valueW;
      ctx.font = fontOf(rw.font, 'normal', labelSize);
      ctx.fillStyle = rw.label_color || '#D7DBE2';
      ctx.fillText(`  ${e.label}`, x, y);
      y += rowGap;
    }

    if (levelUp) {
      ctx.font = fontOf(rw.font, 'bold', luSize);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rw.levelup_color || '#f0b232';
      ctx.fillText(`LEVEL UP!   ${rewards.levelFrom} → ${rewards.levelTo}`, cx, y);
    }
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  layoutPathFor,
  validateResultLayout,
  loadResultSkin,
  renderResultPanel,
};
