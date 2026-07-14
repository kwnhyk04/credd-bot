'use strict';

/**
 * Layout-driven renderer for equipped battle skins.
 *
 * A battle skin is a complete background PNG with a colocated
 * `<skin>.layout.json`. The JSON owns every content position; this module only
 * maps the resolved battle state into those slots. Missing/invalid skins return
 * null so battleRender can preserve its original generic panel unchanged.
 */

const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const {
  assetSignatureSync,
  assetPath,
  loadAssetImage: loadAssetImageSource,
  readAssetJson,
} = require('../utils/assets');

// [Patch 2 §2.1] Class battle bases (classes/battle_base/<class>.png) are a pure
// BACKGROUND SWAP over the default raid geometry — they ship no colocated
// layout, so they reuse the shared base battle layout (identical panel/HP/name
// coordinates). Everything else uses its own colocated <skin>.layout.json.
const DEFAULT_BATTLE_LAYOUT_REL = 'skins/supporters/base/battle.layout.json';
function layoutSourceFor(skinPath) {
  const normalized = String(skinPath || '').replace(/\\/g, '/');
  if (normalized.includes('classes/battle_base/')) return assetPath(DEFAULT_BATTLE_LAYOUT_REL);
  return layoutPathFor(skinPath);
}
const { envNumber, envPositiveInt } = require('../utils/runtimeLogs');
const { encodeOpaqueCanvas, releaseCanvas } = require('../utils/canvasEncode');
const { registerMemorySource } = require('../utils/memoryRegistry');

const ROOT = path.join(__dirname, '..', '..');
const FONT_FALLBACK = 'DejaVu Sans';
for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
  try {
    GlobalFonts.registerFromPath(path.join(ROOT, 'assets', 'fonts', file), FONT_FALLBACK);
  } catch {
    // battleRender registers the same fonts at boot; duplicate registration is harmless.
  }
}

const BATTLE_BASE_CACHE_MAX_ENTRIES = envPositiveInt(
  'BATTLE_STATIC_LAYER_CACHE_MAX',
  envPositiveInt('BATTLE_BASE_CACHE_MAX_ENTRIES', 8, { max: 500 }),
  { max: 500 }
);
const BATTLE_BASE_CACHE_TTL_MS = Math.max(0, envNumber('BATTLE_STATIC_LAYER_CACHE_TTL_MS', 600_000, { min: 0, max: 86_400_000 }));
const BATTLE_STATIC_TOTAL_MAX_MB = envNumber('BATTLE_RENDER_CACHE_MAX_MB', 16, { min: 2, max: 2048 });
const BATTLE_BASE_CACHE_MAX_BYTES = Math.max(
  1024 * 1024,
  envNumber('BATTLE_BASE_CACHE_MAX_MB', BATTLE_STATIC_TOTAL_MAX_MB / 2, { min: 1, max: 2048 }) * 1024 * 1024
);
const skinCache = new Map(); // skin path -> { signature, promise }
const battleBaseCache = new Map(); // skin path -> { signature, canvas, bytes, lastUsed }
let battleBaseCacheBytes = 0;
const warned = new Set();

function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  while (warned.size > 200) warned.delete(warned.values().next().value);
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

function estimateCanvasBytes(canvas) {
  return Math.max(1, (Number(canvas?.width) || 0) * (Number(canvas?.height) || 0) * 4);
}

function dropBattleBase(key) {
  const entry = battleBaseCache.get(key);
  if (!entry) return;
  battleBaseCache.delete(key);
  battleBaseCacheBytes = Math.max(0, battleBaseCacheBytes - entry.bytes);
  releaseCanvas(entry.canvas);
}

function trimBattleBaseCache() {
  while (battleBaseCache.size > BATTLE_BASE_CACHE_MAX_ENTRIES || battleBaseCacheBytes > BATTLE_BASE_CACHE_MAX_BYTES) {
    const oldest = battleBaseCache.entries().next().value;
    if (!oldest) break;
    dropBattleBase(oldest[0]);
  }
}

function trimSkinCache() {
  while (skinCache.size > BATTLE_BASE_CACHE_MAX_ENTRIES) {
    skinCache.delete(skinCache.keys().next().value);
  }
}

function cacheBattleBase(key, signature, canvas) {
  const existing = battleBaseCache.get(key);
  if (existing) {
    dropBattleBase(key);
  }
  const entry = {
    signature,
    canvas,
    bytes: estimateCanvasBytes(canvas),
    lastUsed: Date.now(),
  };
  battleBaseCache.set(key, entry);
  battleBaseCacheBytes += entry.bytes;
  trimBattleBaseCache();
  return canvas;
}

function cachedBattleBase(key, signature) {
  const entry = battleBaseCache.get(key);
  if (!entry) return null;
  if (entry.signature !== signature || (BATTLE_BASE_CACHE_TTL_MS && Date.now() - entry.lastUsed > BATTLE_BASE_CACHE_TTL_MS)) {
    dropBattleBase(key);
    return null;
  }
  entry.lastUsed = Date.now();
  battleBaseCache.delete(key);
  battleBaseCache.set(key, entry);
  return entry.canvas;
}

function clearBattleBaseCache() {
  for (const key of [...battleBaseCache.keys()]) dropBattleBase(key);
}

function getBattleBaseCacheStats() {
  if (BATTLE_BASE_CACHE_TTL_MS) {
    const now = Date.now();
    for (const [key, entry] of battleBaseCache) {
      if (now - entry.lastUsed <= BATTLE_BASE_CACHE_TTL_MS) continue;
      dropBattleBase(key);
    }
  }
  return {
    entries: battleBaseCache.size,
    maxEntries: BATTLE_BASE_CACHE_MAX_ENTRIES,
    bytes: battleBaseCacheBytes,
    maxBytes: BATTLE_BASE_CACHE_MAX_BYTES,
    ttlMs: BATTLE_BASE_CACHE_TTL_MS,
  };
}

/** Load and cache a skin image together with its own colocated layout. */
async function loadBattleSkin(skinPath) {
  if (!skinPath) return null;
  const configPath = layoutSourceFor(skinPath);
  let signature;
  try {
    signature = `${assetSignatureSync(skinPath)}:${assetSignatureSync(configPath)}`;
  } catch {
    warnOnce(skinPath, `[battleLayout] skin or layout missing for ${path.basename(skinPath)}; using default battle render.`);
    return null;
  }

  const cached = skinCache.get(skinPath);
  let promise = cached && cached.signature === signature ? cached.promise : null;
  if (!promise) promise = (async () => {
    const layout = await readAssetJson(configPath);
    if (!validateLayout(layout)) {
      warnOnce(configPath, `[battleLayout] invalid layout ${configPath}; using default battle render.`);
      return null;
    }
    return { layout, skinPath, configPath, signature };
  })().catch((err) => {
    warnOnce(configPath, `[battleLayout] failed to load ${path.basename(skinPath)}: ${err.message}; using default battle render.`);
    return null;
  });

  if (!cached || cached.signature !== signature) {
    skinCache.set(skinPath, { signature, promise });
    trimSkinCache();
  }
  const metadata = await promise;
  if (!metadata) return null;
  try {
    return { ...metadata, image: await loadAssetImageSource(loadImage, skinPath) };
  } catch (err) {
    warnOnce(skinPath, `[battleLayout] failed to load ${path.basename(skinPath)}: ${err.message}; using default battle render.`);
    return null;
  }
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

/**
 * Player loadout drawn with the weapon + deity custom-emoji ICONS followed by their
 * names (then any debuffs). Falls back to just the name when an icon image is missing.
 * Honors the loadout style's anchor / max_width (shrinks the font to fit).
 */
function drawPlayerLoadout(ctx, style, fighter, state, icons) {
  const segs = [
    { img: icons && icons.weapon, text: fighter.weapon || 'None' },
    { text: '   •   ', sep: true },
    { img: icons && icons.deity, text: fighter.deity || 'None' },
  ];
  const dbuff = debuffText(state);
  if (dbuff) segs.push({ text: dbuff, sep: true });

  const maxW = Number(style.max_width) || Infinity;
  let size = Number(style.size) || 16;
  const widthAt = (sz) => {
    ctx.font = fontOf(style, sz);
    const ic = Math.round(sz * 1.2), gap = Math.round(sz * 0.28);
    let w = 0;
    for (const s of segs) { if (s.img) w += ic + gap; w += ctx.measureText(s.text).width; }
    return { w, ic, gap };
  };
  let m = widthAt(size);
  while (size > 10 && m.w > maxW) { size -= 1; m = widthAt(size); }

  let x = style.x;
  if (style.anchor === 'right') x = style.x - m.w;
  else if (style.anchor === 'center') x = style.x - m.w / 2;
  const iconY = Math.round(style.y - size * 0.95);
  ctx.font = fontOf(style, size);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const s of segs) {
    if (s.img) { ctx.drawImage(s.img, x, iconY, m.ic, m.ic); x += m.ic + m.gap; }
    ctx.fillStyle = s.sep ? (style.sep_color || '#9298A4') : (style.color || '#FFFFFF');
    ctx.fillText(s.text, x, style.y);
    x += ctx.measureText(s.text).width;
  }
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

function drawSide(ctx, fighter, state, side, sideIcons) {
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
  // Players show weapon + deity emoji icons in the loadout; mobs keep their skill text.
  if (fighter.kind === 'player') {
    drawPlayerLoadout(ctx, loadoutStyle, fighter, state, sideIcons);
  } else {
    drawFittedText(ctx, side.compact_summary ? compactDetailText(fighter) : detailText(fighter, state), loadoutStyle);
  }
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

function drawStaticBattleBase(ctx, skin) {
  const layout = skin.layout;
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
}

function battleBaseCanvas(skin) {
  const layout = skin.layout;
  const key = skin.skinPath || skin.configPath;
  const signature = skin.signature || key;
  const cached = key ? cachedBattleBase(key, signature) : null;
  if (cached) return cached;

  // Draw oversized bases directly because an undersized cache would release them before use.
  const bytes = Math.max(1, layout.canvas.w * layout.canvas.h * 4);
  if (!key || bytes > BATTLE_BASE_CACHE_MAX_BYTES) return null;

  const base = createCanvas(layout.canvas.w, layout.canvas.h);
  drawStaticBattleBase(base.getContext('2d'), skin);
  return cacheBattleBase(key, signature, base);
}

function drawAction(ctx, action, style) {
  if (!style || !action) return;
  if (style.title) drawFittedText(ctx, action.title || 'Ready', style.title);
  if (style.detail) drawFittedText(ctx, action.detail || '', style.detail);
}

/** Render one battle snapshot over a preloaded equipped skin. */
function renderBattleSkinPanel(sim, snapIdx, skin, { mode = sim.mode, icons = null } = {}) {
  if (!skin || !skin.image || !validateLayout(skin.layout)) return null;
  const layout = skin.layout;
  const state = sim.snapshots[Math.min(snapIdx, sim.snapshots.length - 1)];
  const canvas = createCanvas(layout.canvas.w, layout.canvas.h);
  const ctx = canvas.getContext('2d');
  const base = battleBaseCanvas(skin);
  if (base) ctx.drawImage(base, 0, 0);
  else drawStaticBattleBase(ctx, skin);

  if (isStyle(layout.header)) {
    const label = mode === 'duel' ? `DUEL • TURN ${state.round}` : `BATTLE • TURN ${state.round}`;
    drawFittedText(ctx, label, layout.header);
  }
  drawSide(ctx, sim.a, state.a, layout.player, icons && icons.a);
  drawSide(ctx, sim.b, state.b, layout.enemy, icons && icons.b);
  if (layout.actions && state.actions) {
    drawAction(ctx, state.actions.a, layout.actions.player);
    drawAction(ctx, state.actions.b, layout.actions.enemy);
  }
  return encodeOpaqueCanvas(canvas, { system: 'battle', imageType: 'battle_frame', command: mode });
}

registerMemorySource('battle.layout', () => ({
  layoutEntries: skinCache.size,
  warningEntries: warned.size,
  ...getBattleBaseCacheStats(),
}));

module.exports = {
  layoutPathFor,
  validateLayout,
  loadBattleSkin,
  renderBattleSkinPanel,
  clearBattleBaseCache,
  getBattleBaseCacheStats,
};
