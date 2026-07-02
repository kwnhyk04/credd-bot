'use strict';

/**
 * Layout-driven renderer for the `crd stats` card (Phase 6 — a duplicate of
 * profileLayoutRenderer so stats can be redesigned independently of profile while
 * sharing the SAME skin IMAGE). Every skin owns a colocated `<skin>.stats.layout.json`
 * (copied from its `<skin>.layout.json` to start identical); no skin-specific coords here.
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
  return skinPath.replace(/\.[^.]+$/, '.stats.layout.json');
}

function hasStatsLayout(skinPath) {
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
  const armorPromise = localIcons.armor
    ? loadOptionalImage(localIcons.armor)
    : (d.armorName ? getEmojiIcon(resolveName(d.armorName) || '') : Promise.resolve(null));
  const deityPromise = localIcons.deity
    ? loadOptionalImage(localIcons.deity)
    : (d.deityName ? getEmojiIcon(resolveName(d.deityName) || '') : Promise.resolve(null));
  const deity2Promise = d.deity2Name ? getEmojiIcon(resolveName(d.deity2Name) || '') : Promise.resolve(null);
  const deity3Promise = d.deity3Name ? getEmojiIcon(resolveName(d.deity3Name) || '') : Promise.resolve(null);
  const combatExpPromise = localIcons.combatExp
    ? loadOptionalImage(localIcons.combatExp)
    : getEmojiIcon('combat_exp');

  const [skin, avatar, weapon, armor, deity, deity2, deity3, combatExp] = await Promise.all([
    loadImage(skinPath), avatarPromise, weaponPromise, armorPromise, deityPromise, deity2Promise, deity3Promise, combatExpPromise,
  ]);
  return { skin, avatar, weapon, armor, deity, deity2, deity3, combatExp };
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
  // [Initial-release stats] Weapon and armor are SEPARATE lines (armor on all skins), and the
  // deity row shows ALL THREE slots, auto-centered. Empty slots render as a blank dash so the
  // 1/2/3 layout is always visible ("Deity slot 2 and 3 blank if no deities equipped").
  const deities = [
    d.deityName ? `${d.deityName}${deityEnh}` : '—',
    d.deity2Name || '—',
    d.deity3Name || '—',
  ];
  // [Initial-release stats] Equipments are ONE horizontal line (weapon, armor); deities are a
  // 3-slot auto-centered row; blessings show Divine (slot 1) + Echo (slots 2/3).
  return {
    top_label: d.topLabel?.hasTopLabel ? d.topLabel.word : null,
    name: d.displayName,
    title: d.equippedTitle || '',
    class: `${d.className}  |  Combat Lv ${fmt(d.combatLevel)}`,
    combat_exp: `Combat EXP  ${fmt(d.combatExp)} / ${combatMax}`,
    weapon_label: 'EQUIPMENTS',
    weapon_value: `${weaponTxt}, ${armorTxt}`,
    equipment: [
      { text: weaponTxt, icon: d.weaponName ? 'weapon' : null },
      { text: armorTxt, icon: d.armorName ? 'armor' : null },
    ],
    deity_label: 'DEITIES',
    deities,
    deity_value: deities.join('  ·  '),
    blessing: d.deityName
      ? `Divine: ${d.blessingName || '—'}   ·   Echo: ${d.echoBlessing || '—'}`
      : '',
    stats_label: 'CHARACTER STATS',
    stats: {
      atk: fmt(d.atk), hp: fmt(d.hp), def: fmt(d.def), crit: `${Number(d.crit || 0).toFixed(1)}%`,
    },
    record_label: 'COMBAT STATS',
    record: d.records || {},
    quote: d.quote || '',
  };
}

/**
 * [Phase 6 stats] Armor line — drawn just under the weapon value so every skin shows
 * armor without each layout needing a coordinate. An explicit `armor_value` block in
 * the layout overrides the auto-derived position.
 */
async function drawArmorLine(ctx, layout, view, images) {
  const wv = layout.weapon_value;
  if (!wv || !view.armor_value) return;
  const style = layout.armor_value || {
    ...wv,
    icon: undefined,
    size: Math.max(12, (wv.size || 16) - 2),
    y: wv.y + (wv.armor_dy || 26),
  };
  await drawText(ctx, '__armor', view.armor_value, { __armor: style, name: layout.name }, view, images);
}

function drawEquipmentRow(ctx, layout, view, images) {
  const style = layout.weapon_value;
  if (!style) return;
  const segments = (view.equipment && view.equipment.length)
    ? view.equipment
    : [{ text: view.weapon_value, icon: 'weapon' }];
  const iconSize = style.icon_size || style.size;
  const iconGap = style.icon_gap || 0;
  const sep = ', ';
  const totalWidth = (size) => {
    ctx.font = fontOf({ ...style, size });
    return segments.reduce((sum, seg, i) => {
      const icon = seg.icon ? images[seg.icon] : null;
      const sepW = i > 0 ? ctx.measureText(sep).width : 0;
      const iconW = icon ? iconSize + iconGap : 0;
      return sum + sepW + iconW + ctx.measureText(seg.text).width;
    }, 0);
  };
  let size = style.size;
  const maxWidth = style.max_width || Infinity;
  while (size > 10 && totalWidth(size) > maxWidth) size -= 1;

  ctx.font = fontOf({ ...style, size });
  const width = totalWidth(size);
  let x = style.x;
  if (style.anchor === 'center') x -= width / 2;
  else if (style.anchor === 'right') x -= width;

  ctx.save();
  ctx.font = fontOf({ ...style, size });
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.shadowColor = style.shadow_color || 'rgba(0,0,0,0.88)';
  ctx.shadowBlur = style.shadow_blur ?? 7;
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) {
      ctx.fillText(sep, x, style.y);
      x += ctx.measureText(sep).width;
    }
    const icon = segments[i].icon ? images[segments[i].icon] : null;
    if (icon) {
      ctx.drawImage(icon, x, style.y - iconSize / 2, iconSize, iconSize);
      x += iconSize + iconGap;
    }
    ctx.fillText(segments[i].text, x, style.y);
    x += ctx.measureText(segments[i].text).width;
  }
  ctx.restore();
}

/**
 * [Phase 6 stats] Deity slots 1/2/3 as ONE horizontally auto-centered row, centered on
 * the deity_value anchor x. Font shrinks to fit deity_value.max_width. Names only (no
 * per-slot icon) so all three fit. Overridable spacing via deity_value.deity_gap.
 */
function drawDeitiesRow(ctx, layout, deities, icons = []) {
  const style = layout.deity_value;
  if (!style) return;
  const list = (deities && deities.length) ? deities : ['None'];
  const gap = style.deity_gap ?? 18;
  const maxW = style.max_width || 322;
  const iconGap = 5;
  // Per-slot icon (skipped for blank '—' slots). Sized to the chosen font.
  const iconW = (s) => Math.round(s * 0.95);
  const segWidths = (s) => {
    ctx.font = fontOf({ ...style, size: s });
    return list.map((t, i) => (icons[i] ? iconW(s) + iconGap : 0) + ctx.measureText(t).width);
  };
  let size = style.size;
  const totalAt = (s) => segWidths(s).reduce((a, b) => a + b, 0) + gap * (list.length - 1);
  while (size > 9 && totalAt(size) > maxW) size -= 1;
  ctx.font = fontOf({ ...style, size });
  const widths = segWidths(size);
  const isz = iconW(size);
  let cx = style.x; // LEFT-aligned at the anchor x (was auto-centered)
  ctx.save();
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.shadowColor = style.shadow_color || 'rgba(0,0,0,0.88)';
  ctx.shadowBlur = style.shadow_blur ?? 7;
  for (let i = 0; i < list.length; i++) {
    let x = cx;
    if (icons[i]) { ctx.drawImage(icons[i], x, style.y - isz / 2, isz, isz); x += isz + iconGap; }
    ctx.fillText(list[i], x, style.y);
    cx += widths[i] + gap;
  }
  ctx.restore();
}

// Relabel the record columns so the (formerly duel) PvP cells read as RANK. Keys are unchanged
// so values still resolve; only the displayed labels are swapped. Works for any skin's layout.
const RANK_LABELS = { duels: 'RANK DUELS', duelWins: 'RANK WINS', duelStreak: 'RANK STREAK' };
function relabelRankCols(record) {
  if (!record || !Array.isArray(record.cols)) return record;
  return {
    ...record,
    cols: record.cols.map((c) => (RANK_LABELS[c.key] ? { ...c, label: RANK_LABELS[c.key] } : c)),
  };
}

/**
 * [Initial-release stats] Reposition stats fields without editing every per-skin JSON:
 *  - Character class, combat EXP, equipments, and deities move to the RIGHT column (where the
 *    believer block used to sit — that block is gone on stats), stacked from the name anchor.
 *  - The @user name + supporter title move to the LEFT, centered UNDER the avatar.
 * Positions derive from each skin's own avatar/name/canvas anchors so every skin auto-fits; the
 * existing fit-to-width shrink keeps long names/values inside the border. Stats + record stay put.
 */
function repositionStats(layout, skinPath) {
  const av = layout.avatar;
  const leftCx = av.x + av.size / 2;
  const leftTop = av.y + av.size + 30;
  const colMax = Math.min(av.size + 170, layout.canvas.w - av.x - 20);
  const rx = layout.name.x;
  const ry = layout.name.y;
  const rcw = Math.max(160, layout.canvas.w - rx - 48);
  // Right-column field with an optional font-size bump (more spare space on stats → larger text).
  const R = (style, y, dSize = 0) => ({
    ...style, x: rx, y, anchor: 'left', max_width: rcw, align_to: undefined,
    size: ((style && style.size) || 16) + dSize,
  });
  // p1 (Divine Radiance) & p3 (Aurora Constellation) skins have a themed top space — keep the
  // supporter tier word at the art's original top position instead of moving it under the avatar.
  const keepTopTop = /_p(1|3)\b/i.test(String(skinPath || ''));
  const nameY = leftTop + (keepTopTop ? 4 : 34);
  const titleColor = (layout.tier_line && layout.tier_line.color) || '#67E7FF';
  return {
    ...layout,
    top_label: keepTopTop
      ? layout.top_label
      : { ...layout.top_label, x: leftCx, y: leftTop, anchor: 'center', align_to: undefined, max_width: colMax },
    name: { ...layout.name, x: leftCx, y: nameY, anchor: 'center', max_width: colMax },
    // Equipped title, centered LOWER in the left panel (clear gap below the name).
    title: {
      ...layout.name, x: leftCx, y: nameY + 64, anchor: 'center', max_width: colMax,
      size: Math.max(13, Math.round(((layout.name && layout.name.size) || 40) * 0.42)),
      weight: 'normal', color: titleColor, align_to: undefined,
    },
    class: R(layout.class, ry, 6),
    combat_exp: R(layout.combat_exp, ry + 38, 2),
    weapon_label: R(layout.weapon_label, ry + 80, 3),
    weapon_value: R(layout.weapon_value, ry + 110, 5),
    deity_label: R(layout.deity_label, ry + 156, 3),
    deity_value: {
      ...layout.deity_value,
      x: rx,
      y: layout.deity_value?.stats_y ?? ry + 188,
      anchor: 'left',
      max_width: rcw,
      size: ((layout.deity_value && layout.deity_value.size) || 16) + 5,
    },
    blessing: R(layout.blessing, layout.blessing?.stats_y ?? ry + 222, 0),
  };
}

async function renderStatsLayoutImage(d, options = {}) {
  const skinPath = options.skinPath || d.skinPath;
  const configPath = options.layoutPath || layoutPathFor(skinPath);
  const rawLayout = loadLayout(configPath);
  const layout = repositionStats(rawLayout, skinPath);
  const images = await loadRenderImages(d, skinPath, options);
  const view = buildView(d);

  const canvas = createCanvas(layout.canvas.w, layout.canvas.h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(images.skin, 0, 0, layout.canvas.w, layout.canvas.h);
  drawAvatar(ctx, images.avatar, layout.avatar);

  // [Initial-release stats] Believer level/title/EXP + bar are NOT shown on crd stats
  // (those live on crd profile). Stats focuses on combat: gear, deities, stats, records.
  for (const key of [
    'top_label', 'name', 'title', 'class', 'combat_exp',
    'weapon_label', 'deity_label', 'blessing',
    'stats_label', 'record_label', 'quote',
  ]) {
    if (key === 'top_label' && !rawLayout.top_label.enabled) continue;
    await drawText(ctx, key, view[key], layout, view, images);
  }
  // Equipments are one combined row, with separate icons for weapon and armor.
  drawEquipmentRow(ctx, layout, view, images);
  // Deity slots 1/2/3 left-aligned, each with its emoji icon (blank '—' slots get no icon).
  const deityIcons = [images.deity, images.deity2, images.deity3]
    .map((ic, i) => (view.deities[i] && view.deities[i] !== '—' ? ic : null));
  drawDeitiesRow(ctx, layout, view.deities, deityIcons);
  drawStats(ctx, layout.stats, view.stats);
  // Relabel the duel record columns to RANK (PvP duels became ranked) without editing every
  // per-skin stats.layout.json: re-map the labels by column key at draw time.
  drawRecord(ctx, relabelRankCols(layout.record), view.record);
  return canvas.toBuffer('image/png');
}

module.exports = { hasStatsLayout, layoutPathFor, renderStatsLayoutImage };
