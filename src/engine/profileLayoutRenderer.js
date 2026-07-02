'use strict';

/**
 * Layout-driven renderer for supporter/tester/founder profile skins.
 * Every skin owns a colocated `<skin>.layout.json`; this module contains no
 * skin-specific coordinates.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { getEmojiIcon } = require('./renderBagItems');
const { resolveName } = require('../utils/emojis');
const { formatIntegerEnUS: fmt } = require('../utils/textFormat');

const ROOT = path.join(__dirname, '..', '..');

for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
  GlobalFonts.registerFromPath(path.join(ROOT, 'assets', 'fonts', file), 'DejaVu Sans');
}

function layoutPathFor(skinPath) {
  return skinPath.replace(/\.[^.]+$/, '.layout.json');
}

function hasProfileLayout(skinPath) {
  return Boolean(skinPath && fs.existsSync(layoutPathFor(skinPath)));
}

const layoutCache = new Map(); // layout path -> { mtimeMs, layout }

function loadLayout(configPath) {
  const mtimeMs = fs.statSync(configPath).mtimeMs;
  const cached = layoutCache.get(configPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.layout;

  const layout = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  layoutCache.set(configPath, { mtimeMs, layout });
  return layout;
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

function fontOf(style) {
  return `${style.italic ? 'italic ' : ''}${style.weight === 'bold' ? 'bold ' : ''}` +
    `${style.size}px "${style.font}"`;
}

function fitSize(ctx, text, style, reserved = 0) {
  let size = style.size;
  const maxWidth = (style.max_width || Infinity) - reserved;
  while (size > 10) {
    ctx.font = fontOf({ ...style, size });
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

function textStartX(ctx, text, style, reserved = 0) {
  const width = ctx.measureText(text).width + reserved;
  if (style.anchor === 'center') return style.x - width / 2;
  if (style.anchor === 'right') return style.x - width;
  return style.x;
}

async function loadRemoteImage(primary, fallback) {
  for (const url of [primary, fallback]) {
    if (!url) continue;
    try {
      const response = await fetch(url);
      if (response.ok) return await loadImage(Buffer.from(await response.arrayBuffer()));
    } catch { /* try the fallback */ }
  }
  return null;
}

async function loadOptionalImage(source) {
  if (!source) return null;
  try { return await loadImage(source); } catch { return null; }
}

async function loadRenderImages(d, skinPath, options) {
  const localIcons = options.iconPaths || {};
  const avatarPromise = options.avatarPath
    ? loadOptionalImage(options.avatarPath)
    : loadRemoteImage(d.avatarUrl, d.fallbackAvatarUrl);
  const weaponPromise = localIcons.weapon
    ? loadOptionalImage(localIcons.weapon)
    : (d.weaponName ? getEmojiIcon(resolveName(d.weaponName) || '') : Promise.resolve(null));
  const deityPromise = localIcons.deity
    ? loadOptionalImage(localIcons.deity)
    : (d.deityName ? getEmojiIcon(resolveName(d.deityName) || '') : Promise.resolve(null));
  const combatExpPromise = localIcons.combatExp
    ? loadOptionalImage(localIcons.combatExp)
    : getEmojiIcon('combat_exp');

  const [skin, avatar, weapon, deity, combatExp] = await Promise.all([
    loadImage(skinPath), avatarPromise, weaponPromise, deityPromise, combatExpPromise,
  ]);
  return { skin, avatar, weapon, deity, combatExp };
}

function iconFor(style, layout, images) {
  if (!style.icon) return null;
  if (style.icon === '$weapon') return images.weapon;
  if (style.icon === '$deity') return images.deity;
  if (style.icon === 'combat_exp.png' && images.combatExp) return images.combatExp;
  const abs = path.join(ROOT, ...layout.icons_dir.split('/'), style.icon);
  return loadOptionalImage(abs);
}

async function drawText(ctx, key, content, layout, view, images) {
  const style = layout[key];
  if (!style || content == null || content === '') return;
  let drawStyle = style;
  if (style.align_to === 'name_start') {
    const nameStyle = layout.name;
    const nameText = nameStyle.uppercase ? String(view.name).toUpperCase() : String(view.name);
    const nameSize = fitSize(ctx, nameText, nameStyle);
    ctx.font = fontOf({ ...nameStyle, size: nameSize });
    const nameWidth = ctx.measureText(nameText).width;
    const nameStart = nameStyle.anchor === 'center'
      ? nameStyle.x - nameWidth / 2
      : (nameStyle.anchor === 'right' ? nameStyle.x - nameWidth : nameStyle.x);
    drawStyle = { ...style, x: nameStart, anchor: 'left' };
  }

  const text = style.uppercase ? String(content).toUpperCase() : String(content);
  const icon = await iconFor(drawStyle, layout, images);
  const iconSize = icon ? (drawStyle.icon_size || drawStyle.size) : 0;
  const iconGap = icon ? (drawStyle.icon_gap || 0) : 0;
  const reserved = iconSize + iconGap;
  const size = fitSize(ctx, text, drawStyle, reserved);

  ctx.save();
  ctx.font = fontOf({ ...drawStyle, size });
  ctx.fillStyle = drawStyle.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.shadowColor = drawStyle.shadow_color || 'rgba(0,0,0,0.88)';
  ctx.shadowBlur = drawStyle.shadow_blur ?? 7;
  const startX = textStartX(ctx, text, drawStyle, reserved);
  if (icon) ctx.drawImage(icon, startX, drawStyle.y - iconSize / 2, iconSize, iconSize);
  ctx.fillText(text, startX + reserved, drawStyle.y);
  ctx.restore();
}

function drawProgress(ctx, style, ratio) {
  ctx.save();
  roundRect(ctx, style.x, style.y, style.w, style.h, style.radius);
  ctx.fillStyle = style.track;
  ctx.fill();
  const normalized = Math.max(0, Math.min(1, Number(ratio) || 0));
  if (normalized > 0) {
    const fillW = Math.max(style.h, style.w * normalized);
    roundRect(ctx, style.x, style.y, fillW, style.h, style.radius);
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  ctx.restore();
}

function drawCover(ctx, img, box) {
  const scale = Math.max(box.size / img.width, box.size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, box.x + (box.size - w) / 2, box.y + (box.size - h) / 2, w, h);
}

function drawAvatar(ctx, img, style) {
  ctx.save();
  if (style.glow) {
    ctx.shadowColor = style.glow.color;
    ctx.globalAlpha = style.glow.alpha;
    ctx.shadowBlur = style.glow.blur;
    roundRect(ctx, style.x, style.y, style.size, style.size, style.radius);
    ctx.fillStyle = style.glow.color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  roundRect(ctx, style.x, style.y, style.size, style.size, style.radius);
  ctx.clip();
  if (img) drawCover(ctx, img, style);
  else {
    ctx.fillStyle = 'rgba(20,22,28,0.92)';
    ctx.fillRect(style.x, style.y, style.size, style.size);
  }
  ctx.restore();

  ctx.save();
  roundRect(ctx, style.x, style.y, style.size, style.size, style.radius);
  ctx.strokeStyle = style.outline;
  ctx.lineWidth = style.outline_width;
  ctx.stroke();
  ctx.restore();
}

function drawStats(ctx, style, values) {
  if (style.mode === 'inline') {
    for (const col of style.cols) {
      ctx.save();
      roundRect(ctx, col.x, style.y - style.marker_size / 2,
        style.marker_size, style.marker_size, style.marker_radius);
      ctx.fillStyle = col.color;
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `${style.weight === 'bold' ? 'bold ' : ''}${style.size}px "${style.font}"`;
      ctx.fillStyle = col.color;
      ctx.fillText(col.label, col.x + style.marker_size + style.marker_gap, style.y);
      ctx.fillStyle = style.value_color;
      ctx.fillText(values[col.key] ?? '0', col.x + style.value_offset, style.y);
      ctx.restore();
    }
    return;
  }

  for (const col of style.cols) {
    const x = col.x - style.chip_w / 2;
    ctx.save();
    roundRect(ctx, x, style.y, style.chip_w, style.chip_h, style.chip_radius);
    ctx.fillStyle = style.chip_fill;
    ctx.fill();
    ctx.strokeStyle = style.chip_outline;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${style.weight === 'bold' ? 'bold ' : ''}${style.size}px "${style.font}"`;
    ctx.fillStyle = col.color;
    ctx.fillText(col.label, col.x, style.y + style.label_gap);
    ctx.fillStyle = style.value_color;
    ctx.fillText(values[col.key] ?? '0', col.x, style.y + style.value_gap);
    ctx.restore();
  }
}

function drawRecord(ctx, style, values) {
  for (const col of style.cols) {
    const x = col.x - style.box_w / 2;
    ctx.save();
    roundRect(ctx, x, style.y, style.box_w, style.box_h, style.radius);
    ctx.fillStyle = style.box_fill;
    ctx.fill();
    ctx.strokeStyle = style.box_outline;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${style.label_weight === 'bold' ? 'bold ' : ''}${style.label_size}px "${style.label_font}"`;
    ctx.fillStyle = style.label_color;
    ctx.fillText(col.label, col.x, style.y + 18);
    ctx.font = `${style.value_weight === 'bold' ? 'bold ' : ''}${style.value_size}px "${style.value_font}"`;
    ctx.fillStyle = style.value_color;
    ctx.fillText(String(values[col.key] ?? 0), col.x, style.y + 40);
    ctx.restore();
  }
}

function profileTitle(d) {
  if (d.profileTitle) return d.profileTitle;
  if (/^Founder\b/i.test(d.topLabel?.word || '')) return 'Eternal Founder';
  return d.believerTitle;
}

function buildView(d) {
  const combatMax = d.combatExpMax == null ? 'MAX' : fmt(d.combatExpMax);
  const weaponEnh = d.weaponEnh > 0 ? ` +${d.weaponEnh}` : '';
  const armorEnh = d.armorEnh > 0 ? ` +${d.armorEnh}` : '';
  const deityEnh = d.deityEnh > 0 ? ` +${d.deityEnh}` : '';
  // [v5 tweak] One "Equipments" value carries BOTH weapon and armor so long names
  // can't overlap by position (armor has no separate layout element). Armor type
  // ("(Medium)") is no longer shown.
  const weaponTxt = d.weaponName ? `${d.weaponName}${weaponEnh}` : 'None';
  const armorTxt = d.armorName ? `${d.armorName}${armorEnh}` : 'None';
  return {
    top_label: d.topLabel?.hasTopLabel ? d.topLabel.word : null,
    name: d.displayName,
    title: d.equippedTitle || '',
    tier_line: `Believer Level ${fmt(d.believerLevel)}  |  ${profileTitle(d)}`,
    exp_text: `${fmt(d.believerExp)} / ${fmt(d.believerExpMax)} Believer EXP`,
    exp_ratio: Number(d.believerExp) / Math.max(1, Number(d.believerExpMax)),
    class: `${d.className}  |  Combat Lv ${fmt(d.combatLevel)}`,
    combat_exp: `Combat EXP  ${fmt(d.combatExp)} / ${combatMax}`,
    weapon_label: 'EQUIPMENTS',
    weapon_value: `${weaponTxt}, ${armorTxt}`,
    deity_label: 'ACTIVE DEITY',
    deity_value: d.deityName ? `${d.deityName}${deityEnh}` : 'None',
    blessing: d.deityName ? `Blessing: ${d.blessingName || '-'}` : '',
    stats_label: 'CHARACTER STATS',
    stats: {
      atk: fmt(d.atk), hp: fmt(d.hp), def: fmt(d.def), crit: `${Number(d.crit || 0).toFixed(1)}%`,
    },
    record_label: 'RANK COMBAT RECORD',
    record: d.records || {},
    quote: d.quote || '',
  };
}

// Relabel the (formerly duel) record columns to RANK without editing every per-skin layout JSON.
const RANK_LABELS = { duels: 'RANK DUELS', duelWins: 'RANK WINS', duelStreak: 'RANK STREAK' };
function relabelRankCols(record) {
  if (!record || !Array.isArray(record.cols)) return record;
  return {
    ...record,
    cols: record.cols.map((c) => (RANK_LABELS[c.key] ? { ...c, label: RANK_LABELS[c.key] } : c)),
  };
}

/**
 * Draw the equipped title centered horizontally under the name. The title centers on the NAME's
 * measured center (so it reads centered beneath the name regardless of the name's anchor), a few
 * px below it. Skipped when no title is equipped. Position tunable via name.title_dy.
 */
async function drawCenteredTitle(ctx, layout, view, images) {
  const title = view.title;
  if (!title || !layout.name) return;
  if (layout.title) {
    await drawText(ctx, 'title', title, layout, view, images);
    return;
  }
  const ns = layout.name;
  const nameText = ns.uppercase ? String(view.name).toUpperCase() : String(view.name);
  const nameSize = fitSize(ctx, nameText, ns);
  ctx.font = fontOf({ ...ns, size: nameSize });
  const w = ctx.measureText(nameText).width;
  const nameStart = ns.anchor === 'center' ? ns.x - w / 2 : (ns.anchor === 'right' ? ns.x - w : ns.x);
  const centerX = nameStart + w / 2;
  // Position the title LOWER — below the believer EXP bar (in the now-empty profile body),
  // centered on the name. Falls back to a fixed offset under the name if there's no exp bar.
  const titleY = (layout.exp_bar && Number.isFinite(layout.exp_bar.y))
    ? layout.exp_bar.y + (ns.title_dy || 48)
    : ns.y + (ns.title_dy || 120);
  const style = {
    font: ns.font, weight: 'normal', size: Math.max(13, Math.round((ns.size || 40) * 0.40)),
    color: (layout.tier_line && layout.tier_line.color) || '#67E7FF',
    x: centerX, y: titleY, anchor: 'center', max_width: ns.max_width || 600,
  };
  await drawText(ctx, '__title', title, { __title: style, name: layout.name }, view, images);
}

async function renderProfileLayoutImage(d, options = {}) {
  const skinPath = options.skinPath || d.skinPath;
  const configPath = options.layoutPath || layoutPathFor(skinPath);
  const layout = loadLayout(configPath);
  const images = await loadRenderImages(d, skinPath, options);
  const view = buildView(d);

  const canvas = createCanvas(layout.canvas.w, layout.canvas.h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(images.skin, 0, 0, layout.canvas.w, layout.canvas.h);
  drawAvatar(ctx, images.avatar, layout.avatar);
  drawProgress(ctx, layout.exp_bar, view.exp_ratio);

  // [Initial-release profile] Equipments, deities, and character stats are NOT shown on
  // crd profile (moved to crd stats). Profile keeps identity + believer progression + records.
  for (const key of [
    'top_label', 'name', 'tier_line', 'exp_text', 'class', 'combat_exp',
    'record_label', 'quote',
  ]) {
    if (key === 'top_label' && !layout.top_label.enabled) continue;
    await drawText(ctx, key, view[key], layout, view, images);
  }
  await drawCenteredTitle(ctx, layout, view, images);
  drawRecord(ctx, relabelRankCols(layout.record), view.record);
  return canvas.toBuffer('image/png');
}

module.exports = { hasProfileLayout, layoutPathFor, renderProfileLayoutImage };
