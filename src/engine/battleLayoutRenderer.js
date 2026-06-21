'use strict';

/**
 * Layout-driven renderer for equipped battle skins.
 *
 * A battle skin is a complete background PNG with a colocated
 * `<skin>.layout.json`. The JSON owns every content position; this module only
 * maps the resolved battle state into those slots. Missing/invalid skins return
 * null so battleRender can preserve its original generic panel unchanged.
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

function validateLayout(layout) {
  if (!layout || !layout.canvas || !Number.isFinite(layout.canvas.w) || !Number.isFinite(layout.canvas.h)) {
    return false;
  }
  for (const sideName of ['player', 'enemy']) {
    const side = layout[sideName];
    if (!side || !isStyle(side.name) || !isStyle(side.sub) || !isStyle(side.loadout) ||
        !isStyle(side.hp_text) || !side.hp_bar || !isStyle(side.hp_bar) ||
        !Number.isFinite(side.hp_bar.w) || !Number.isFinite(side.hp_bar.h) ||
        !side.stats || !isStyle(side.stats) || !Array.isArray(side.stats.cols)) {
      return false;
    }
  }
  return true;
}

/** Load and cache a skin image together with its own colocated layout. */
async function loadBattleSkin(skinPath) {
  if (!skinPath) return null;
  const configPath = layoutPathFor(skinPath);
  let signature;
  try {
    signature = `${fs.statSync(skinPath).mtimeMs}:${fs.statSync(configPath).mtimeMs}`;
  } catch {
    warnOnce(skinPath, `[battleLayout] skin or layout missing for ${path.basename(skinPath)}; using default battle render.`);
    return null;
  }

  const cached = skinCache.get(skinPath);
  if (cached && cached.signature === signature) return cached.promise;

  const promise = (async () => {
    const layout = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!validateLayout(layout)) {
      warnOnce(configPath, `[battleLayout] invalid layout ${configPath}; using default battle render.`);
      return null;
    }
    const image = await loadImage(skinPath);
    return { image, layout, skinPath, configPath };
  })().catch((err) => {
    warnOnce(configPath, `[battleLayout] failed to load ${path.basename(skinPath)}: ${err.message}; using default battle render.`);
    return null;
  });

  skinCache.set(skinPath, { signature, promise });
  return promise;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(Number(r) || 0, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fontOf(style, size = style.size) {
  const family = style.font || FONT_FALLBACK;
  return `${style.weight === 'bold' ? 'bold ' : ''}${Math.max(10, Number(size) || 16)}px "${family}"`;
}

function anchorOf(style) {
  return ['left', 'center', 'right'].includes(style.anchor) ? style.anchor : 'left';
}

/** Draw one configured line, shrinking and finally ellipsizing to max_width. */
function drawFittedText(ctx, rawText, style) {
  const text = String(rawText ?? '');
  const maxWidth = Number(style.max_width) || Infinity;
  let size = Number(style.size) || 16;
  ctx.font = fontOf(style, size);
  while (size > 10 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = fontOf(style, size);
  }

  let fitted = text;
  if (ctx.measureText(fitted).width > maxWidth) {
    while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1);
    fitted = `${fitted}…`;
  }

  ctx.textAlign = anchorOf(style);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = style.color || '#FFFFFF';
  ctx.fillText(fitted, style.x, style.y);
  return { text: fitted, width: ctx.measureText(fitted).width, size };
}

function classLabel(fighter) {
  if (fighter.kind === 'player') return fighter.cls || 'Believer';
  if (fighter.cls === 'boss') return 'Boss';
  if (fighter.cls === 'elite') return 'Elite Mob';
  return 'Mob';
}

function debuffText(state) {
  const tags = (state.debuffs || []).map((d) => d.tag).filter(Boolean);
  return tags.length ? `  |  Debuffs: ${tags.join(', ')}` : '';
}

function detailText(fighter, state) {
  if (fighter.kind === 'player') {
    return `Weapon: ${fighter.weapon || 'None'}  |  Deity: ${fighter.deity || 'None'}${debuffText(state)}`;
  }
  const skill = fighter.skillDesc
    ? `${fighter.skill || 'Skill'} — ${fighter.skillDesc}`
    : (fighter.skill || 'None');
  return `Skill: ${skill}${debuffText(state)}`;
}

function compactDetailText(fighter) {
  if (fighter.kind === 'player') {
    return `|  ${fighter.weapon || 'None'}  |  Deity: ${fighter.deity || 'None'}`;
  }
  const skill = fighter.skillDesc
    ? `${fighter.skill || 'Skill'}: ${fighter.skillDesc}`
    : (fighter.skill || 'None');
  return `|  ${skill}`;
}

function drawHpBar(ctx, style, state) {
  const pct = Math.max(0, Math.min(1, state.maxHp > 0 ? state.hp / state.maxHp : 0));
  roundRect(ctx, style.x, style.y, style.w, style.h, style.radius);
  ctx.fillStyle = style.track || 'rgba(0,0,0,0.45)';
  ctx.fill();
  if (pct <= 0) return;
  const fillW = Math.max(Math.min(style.h, style.w), style.w * pct);
  roundRect(ctx, style.x, style.y, fillW, style.h, style.radius);
  ctx.fillStyle = style.fill || '#43D675';
  ctx.fill();
}

function statValue(fighter, key) {
  if (key === 'crit') return `${Number(fighter.crit).toFixed(1)}%`;
  return fighter[key] ?? '—';
}

function drawStats(ctx, fighter, style) {
  ctx.textAlign = anchorOf(style);
  ctx.textBaseline = 'alphabetic';
  const gap = Number(style.gap) || 150;
  for (let i = 0; i < style.cols.length; i++) {
    const col = style.cols[i];
    const x = Number.isFinite(col.x) ? col.x : style.x + i * gap;
    ctx.font = fontOf(style);
    ctx.fillStyle = col.color || style.color || '#FFFFFF';
    ctx.fillText(`${col.label || String(col.key).toUpperCase()} ${statValue(fighter, col.key)}`, x, style.y);
  }
}

function drawSide(ctx, fighter, state, side) {
  const name = drawFittedText(
    ctx,
    side.level ? fighter.name : `${fighter.name}${fighter.level ? `  Lv.${fighter.level}` : ''}`,
    side.name
  );
  if (side.level && fighter.level) {
    const levelStyle = { ...side.level };
    if (levelStyle.flow_after_name) levelStyle.x = side.name.x + name.width + (Number(levelStyle.gap) || 18);
    drawFittedText(ctx, `Lv.${fighter.level}`, levelStyle);
  }

  const sub = drawFittedText(ctx, classLabel(fighter), side.sub);
  const loadoutStyle = { ...side.loadout };
  if (loadoutStyle.flow_after_sub) {
    loadoutStyle.x = side.sub.x + sub.width + (Number(loadoutStyle.gap) || 14);
  }
  drawFittedText(ctx, side.compact_summary ? compactDetailText(fighter) : detailText(fighter, state), loadoutStyle);
  drawFittedText(ctx, `${state.hp.toLocaleString()} / ${state.maxHp.toLocaleString()}`, side.hp_text);
  drawHpBar(ctx, side.hp_bar, state);
  drawStats(ctx, fighter, side.stats);
}

function drawRect(ctx, rect) {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.w) || !Number.isFinite(rect.h)) return;
  if (rect.radius) {
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.radius);
    ctx.fillStyle = rect.fill || '#040816';
    ctx.fill();
  } else {
    ctx.fillStyle = rect.fill || '#040816';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
}

function drawAction(ctx, action, style) {
  if (!style || !action) return;
  if (style.title) drawFittedText(ctx, action.title || 'Ready', style.title);
  if (style.detail) drawFittedText(ctx, action.detail || '', style.detail);
}

/** Render one battle snapshot over a preloaded equipped skin. */
function renderBattleSkinPanel(sim, snapIdx, skin, { mode = sim.mode } = {}) {
  if (!skin || !skin.image || !validateLayout(skin.layout)) return null;
  const layout = skin.layout;
  const state = sim.snapshots[Math.min(snapIdx, sim.snapshots.length - 1)];
  const canvas = createCanvas(layout.canvas.w, layout.canvas.h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(skin.image, 0, 0, layout.canvas.w, layout.canvas.h);

  drawRect(ctx, layout.surface);
  if (layout.divider && Number.isFinite(layout.divider.y)) {
    ctx.fillStyle = layout.divider.color || 'rgba(255,255,255,0.12)';
    ctx.fillRect(
      Number(layout.divider.x) || 0,
      layout.divider.y,
      Number(layout.divider.w) || layout.canvas.w,
      Math.max(1, Number(layout.divider.h) || 1)
    );
  }

  if (isStyle(layout.header)) {
    const label = mode === 'duel' ? `DUEL • TURN ${state.round}` : `BATTLE • TURN ${state.round}`;
    drawFittedText(ctx, label, layout.header);
  }
  drawSide(ctx, sim.a, state.a, layout.player);
  drawSide(ctx, sim.b, state.b, layout.enemy);
  if (layout.actions && state.actions) {
    drawAction(ctx, state.actions.a, layout.actions.player);
    drawAction(ctx, state.actions.b, layout.actions.enemy);
  }
  return canvas.toBuffer('image/png');
}

module.exports = {
  layoutPathFor,
  validateLayout,
  loadBattleSkin,
  renderBattleSkinPanel,
};
