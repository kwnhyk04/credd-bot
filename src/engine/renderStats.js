'use strict';

/**
 * renderProfile.js — full Canvas profile card for `crd profile` / `crd stats` (Phase 9).
 *
 * Same dark-box visual language as renderBagItems / renderQuestRows (shared FONT_FAMILY,
 * palette, rounded boxes, disk-cached CDN emoji icons). One PNG, posted as an attachment
 * inside a thin CV2 container by the command.
 *
 * Layout:
 *   header band  — left: display name / believer level + title / believer EXP bar
 *                  right: squared Discord avatar (rounded corners)
 *   separator
 *   body block   — class + combat level / combat EXP bar / weapon / deity blessing / stats
 *   separator
 *   records      — four boxed stat cells (Raids · Raids Won · Duels · Duel Wins)
 *   footer       — italic myth quote (deterministic per discord_id)
 *
 * All displayed totals come from the caller, which assembles them through the SAME
 * stat-assembly path the battle engine uses (assemblePlayerStats), so the card never
 * disagrees with what actually fights.
 */

const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { getEmojiIcon, FONT_FAMILY } = require('./renderBagItems');
const { hasStatsLayout, renderStatsLayoutImage } = require('./statsLayoutRenderer');
const { resolveName } = require('../utils/emojis');
const { assetPath, loadAssetImage: loadAssetImageSource } = require('../utils/assets');
const { loadAvatarAsset } = require('./avatarImageLoader');
const { performanceLog } = require('../utils/runtimeLogs');
const { SUPPORTER_BADGE_HEIGHT } = require('../config/cosmetics');
const { containRect, badgeRect } = require('./identityLayout');

/* ── Background template ([v4.6]) ───────────────────────────────────────────
 * The profile card is drawn on top of a template image. TEMPLATE_FILE is a single
 * swappable constant — the planned SUPPORTER phase will pick a per-user template
 * (believer_/cbeliever_/eternal_) without restructuring this renderer. A faint scrim
 * keeps text legible over arbitrary art. If the template is missing, fall back to the
 * old flat dark background at the native 600-wide layout. */
const TEMPLATE_FILE = 'default_template.png';
const SCRIM = 'rgba(18,19,22,0.50)';
let templateCache;
function loadTemplate() {
  if (templateCache === undefined) {
    templateCache = loadAssetImage(assetPath(`profile/${TEMPLATE_FILE}`)).catch(() => null);
  }
  return templateCache;
}

async function loadAssetImage(source) {
  return loadAssetImageSource(loadImage, source);
}

/* ── Layout ─────────────────────────────────────────────────────────────── */
const W = 600;
const PAD = 22;
const AVATAR_W = 104;
const AVATAR_H = 146;
const RADIUS = 12;

/* ── Colors (near Discord dark, matching the bag/quest renders) ─────────── */
const BG = '#1E1F22';
const BOX = '#26272D';
const ACCENT = '#9b59b6';
const NAME_COLOR = '#FFFFFF';
const SUB_COLOR = '#B5B8BE';
const DIM_COLOR = '#8E919A';

// Stat cell accent colors.
const STAT = {
  atk: '#f23f43',  // red
  hp: '#43d675',   // green
  def: '#5865F2',  // blue
  crit: '#f0b232', // amber
};
// Records cell value colors.
const REC_COLOR = '#43d675';

/* ── Typography ─────────────────────────────────────────────────────────── */
const F = (px, bold = false) => `${bold ? 'bold ' : ''}${px}px "${FONT_FAMILY}"`;

/* ── Myth quotes — deterministic per discord_id (stable per user) ───────── */
const QUOTES = [
  'The gods remember your name, Last Believer.',
  'Faith is the only blade that never dulls.',
  'Where worship fades, you remain.',
  'The old powers stir when you draw near.',
  'Every prayer unanswered still finds you.',
  'You carry what the heavens forgot.',
];
function quoteFor(discordId) {
  const id = String(discordId || '');
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return QUOTES[h % QUOTES.length];
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxW) {
  if (maxW <= 0 || ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function imageSourceCandidates(source) {
  if (!source) return [];
  const s = String(source).replace(/\\/g, '/');
  const match = /^(.*)\.(png|jpe?g|webp)$/i.exec(s);
  if (!match) return [s];
  const exts = [match[2].toLowerCase(), 'webp', 'png', 'jpg', 'jpeg'];
  const bases = [match[1]];
  const folderStyle = /^(.*\/(?:skins\/)?avatars\/(?:male|female))\/([^/]+)\/([^/]+)$/i.exec(match[1]);
  if (folderStyle) {
    const [, prefix, classFolder, fileStem] = folderStyle;
    const styleOnly = /^(cyber|anime|webtoon)$/i.exec(fileStem);
    const stemStyle = new RegExp(`^${classFolder}_(cyber|anime|webtoon)$`, 'i').exec(fileStem);
    const style = (styleOnly?.[1] || stemStyle?.[1] || '').toLowerCase();
    if (style) {
      bases.push(`${prefix}/${classFolder}/${classFolder}_${style}`);
      if (classFolder.toLowerCase() === 'archer') bases.push(`${prefix}/${classFolder}/acher_${style}`);
    }
  }
  for (const base of [...bases]) {
    const withoutSkins = base.replace(/\/skins\/avatars\//i, '/avatars/');
    if (withoutSkins !== base) bases.push(withoutSkins);
    if (!/\/skins\/avatars\//i.test(base)) {
      const withSkins = base.replace(/\/avatars\//i, '/skins/avatars/');
      if (withSkins !== base) bases.push(withSkins);
    }
  }
  return [...new Set(bases.flatMap((base) => exts.map((ext) => `${base}.${ext}`)))];
}

/** Stats avatar fetch: character avatar/class art only; renderer draws a placeholder if unavailable. */
async function loadAvatar(avatarPath, avatarFallbackPath, logContext = {}) {
  const gameAvatar = await loadAvatarAsset(loadAssetImage, [
    avatarPath ? { path: avatarPath, avatarSource: 'equipped-avatar' } : null,
    avatarFallbackPath ? { path: avatarFallbackPath, avatarSource: 'class-fallback' } : null,
  ], logContext);
  if (gameAvatar) return gameAvatar;
  performanceLog('stats avatar placeholder used', {
    ...logContext,
    reason: 'character-avatar-unavailable',
  });
  return null;
}

function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * @param {object} d
 *   displayName, discordId, avatarUrl, fallbackAvatarUrl
 *   believerLevel, believerTitle, believerExp, believerExpMax
 *   className, combatLevel, combatExp, combatExpMax  (combatExpMax null at cap)
 *   weaponName|null, weaponEnh (0 = +0), deityName|null, deityEnh, blessingName|null
 *   atk, hp, def, crit
 *   records: { raids, raidsWon, duels, duelWins }
 * @returns {Promise<Buffer>} PNG
 */
async function renderStatsImage(d) {
  // [Phase 6] crd stats — its own renderer + `<skin>.stats.layout.json` configs, sharing
  // the same skin IMAGE as profile. Skins without a stats layout fall back to the default
  // card below (identical to profile until the stats layout is redesigned).
  if (hasStatsLayout(d.skinPath)) {
    try {
      return await renderStatsLayoutImage({ ...d, quote: `"${quoteFor(d.discordId)}"` });
    } catch (err) {
      console.error(`[stats] layout render failed for ${path.basename(d.skinPath)}:`, err);
    }
  }

  // Pre-fetch images (frame + avatar + weapon/deity/combat-exp icons) before laying out.
  // [Supporter-stage §6] When a profile skin resolves (d.skinPath), it replaces the default
  // template as the bottom layer; otherwise fall back to the shared default template.
  const [template, avatar, weaponIcon, armorIcon, deityIcon, deity2Icon, deity3Icon, expIcon, supporterBadge] = await Promise.all([
    d.skinPath ? loadAssetImage(d.skinPath).catch(() => null).then((img) => img || loadTemplate()) : loadTemplate(),
    loadAvatar(d.avatarPath, d.avatarFallbackPath, {
      system: 'stats',
      command: 'stats',
      imageType: 'stats_avatar',
      userId: d.discordId,
    }),
    d.weaponName ? getEmojiIcon(resolveName(d.weaponName) || '') : Promise.resolve(null),
    d.armorName ? getEmojiIcon(resolveName(d.armorName) || '') : Promise.resolve(null),
    d.deityName ? getEmojiIcon(resolveName(d.deityName) || '') : Promise.resolve(null),
    d.deity2Name ? getEmojiIcon(resolveName(d.deity2Name) || '') : Promise.resolve(null),
    d.deity3Name ? getEmojiIcon(resolveName(d.deity3Name) || '') : Promise.resolve(null),
    getEmojiIcon('combat_exp'),
    // [§2.5] supporter badge — path only set when tier is active AND art exists;
    // a load failure still skips the layer gracefully.
    d.supporterBadgePath ? loadAssetImage(d.supporterBadgePath).catch(() => null) : Promise.resolve(null),
  ]);

  // ── Measure the layout (600-wide design space) ──
  const headerH = 118;
  const bodyH = 264;            // class, combat-exp, weapon, armor, deity hdr+val+blessing, stats [v5 +armor]
  const recordsH = 110;         // "Combat Record" heading + boxed cells
  const footerH = 30;
  const layoutH = headerH + 12 + bodyH + 12 + recordsH + 12 + footerH;

  // Canvas = template size when present; otherwise the flat 600×layoutH fallback. The whole
  // 600-wide layout is scaled to the template height and centered, so positions below are
  // authored once in design space and the transform maps them onto the template.
  const canvas = createCanvas(template ? template.width : W, template ? template.height : layoutH);
  const ctx = canvas.getContext('2d');
  if (template) {
    ctx.drawImage(template, 0, 0, template.width, template.height);
    ctx.fillStyle = SCRIM;
    ctx.fillRect(0, 0, template.width, template.height);
    // [Supporter-stage §6] Top-label word ("Founder NNN" / tier) in the skin's top word-space.
    // Drawn in raw canvas space (above the scaled layout) so it sits in the art's reserved band.
    if (d.topLabel && d.topLabel.hasTopLabel && d.topLabel.word) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fs = Math.round(template.height * 0.032);
      ctx.font = `bold ${fs}px "${FONT_FAMILY}"`;
      ctx.fillStyle = '#F5E6C8';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 6;
      ctx.fillText(d.topLabel.word, template.width / 2, Math.round(template.height * 0.06));
      ctx.restore();
    }
    const s = template.height / layoutH;
    ctx.translate((template.width - W * s) / 2, 0);
    ctx.scale(s, s);
  } else {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, layoutH);
  }
  ctx.textBaseline = 'alphabetic';

  let y = PAD;

  /* ── HEADER ─────────────────────────────────────────────── */
  // Name + equipped title centered in the top header.
  const nameW = W - PAD * 2;
  ctx.textAlign = 'center';
  ctx.font = F(26, true);
  ctx.fillStyle = NAME_COLOR;
  const nameY = y + 48;
  ctx.fillText(fitText(ctx, d.displayName, nameW), W / 2, nameY);
  if (d.equippedTitle) {
    ctx.font = F(14, true);
    ctx.fillStyle = ACCENT;
    ctx.fillText(fitText(ctx, d.equippedTitle, nameW), W / 2, nameY + 30);
  }
  ctx.textAlign = 'left';

  y = headerH;

  /* ── SEPARATOR ──────────────────────────────────────────── */
  function separator(yy) {
    ctx.strokeStyle = '#36393f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, yy);
    ctx.lineTo(W - PAD, yy);
    ctx.stroke();
  }
  separator(y);
  y += 12;

  const ax = W - PAD - AVATAR_W;
  const ay = y + 2;
  const avatarRect = containRect(avatar, { x: ax, y: ay, w: AVATAR_W, h: AVATAR_H });
  ctx.save();
  roundRectPath(ctx, avatarRect.x, avatarRect.y, avatarRect.w, avatarRect.h, 14);
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, avatarRect.x, avatarRect.y, avatarRect.w, avatarRect.h);
  } else {
    ctx.fillStyle = BOX;
    ctx.fillRect(avatarRect.x, avatarRect.y, avatarRect.w, avatarRect.h);
  }
  ctx.restore();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  roundRectPath(ctx, avatarRect.x, avatarRect.y, avatarRect.w, avatarRect.h, 14);
  ctx.stroke();
  if (supporterBadge) {
    const rect = badgeRect(supporterBadge, {
      x: avatarRect.x + avatarRect.w / 2,
      titleY: 0,
      hasTitle: false,
      fallbackY: avatarRect.y + 50,
      height: SUPPORTER_BADGE_HEIGHT,
    });
    ctx.drawImage(supporterBadge, rect.x, rect.y, rect.w, rect.h);
  }
  const bodyRight = ax - 16;
  const bodyW = bodyRight - PAD;

  /* ── BODY ───────────────────────────────────────────────── */
  let by = y + 18;
  const LH = 22;

  // Class + combat level.
  ctx.font = F(16, true);
  ctx.fillStyle = NAME_COLOR;
  ctx.fillText(fitText(ctx, `Character Class: ${d.className}, Lvl ${d.combatLevel}`, bodyW), PAD, by);
  by += LH;

  // Combat EXP — single text line with the combat-exp icon, no bar.
  let cex = PAD;
  if (expIcon) { ctx.drawImage(expIcon, cex, by - 13, 15, 15); cex += 19; }
  ctx.font = F(13);
  ctx.fillStyle = SUB_COLOR;
  const needed = d.combatExpMax == null ? 'MAX' : Number(d.combatExpMax).toLocaleString();
  ctx.fillText(fitText(ctx, `Combat EXP: ${Number(d.combatExp).toLocaleString()} / ${needed}`, bodyRight - cex), cex, by);
  by += LH + 8;

  // Inline "icon + text" segments on one row (icon optional). Returns the new x cursor.
  const ICON = 18;
  function segmentWidth(segments, size) {
    ctx.font = F(size, true);
    return segments.reduce((sum, item) => sum + (item.icon ? ICON + 5 : 0) + ctx.measureText(item.text).width, 0);
  }
  function drawSegments(segments, x, yy, maxW, baseSize = 15) {
    let size = baseSize;
    while (size > 9 && segmentWidth(segments, size) > maxW) size -= 1;
    ctx.font = F(size, true);
    let cx = x;
    for (const item of segments) {
      if (item.icon) {
        const isz = Math.max(12, Math.round(ICON * (size / baseSize)));
        ctx.drawImage(item.icon, cx, yy - isz + 3, isz, isz);
        cx += isz + 5;
      }
      const text = fitText(ctx, item.text, Math.max(20, x + maxW - cx));
      ctx.fillText(text, cx, yy);
      cx += ctx.measureText(text).width;
    }
  }

  // Equipments — weapon + armor on ONE horizontal line, each with its emoji icon.
  ctx.font = F(13, true);
  ctx.fillStyle = DIM_COLOR;
  ctx.fillText('Equipments:', PAD, by);
  by += LH;
  ctx.font = F(15, true);
  ctx.fillStyle = NAME_COLOR;
  const wTxt = d.weaponName ? `${d.weaponName}${d.weaponEnh > 0 ? ` +${d.weaponEnh}` : ''}` : 'None';
  const aTxt = d.armorName ? `${d.armorName}${d.armorEnh > 0 ? ` +${d.armorEnh}` : ''}` : 'None';
  drawSegments([
    { icon: d.weaponName ? weaponIcon : null, text: wTxt },
    { icon: null, text: ',  ' },
    { icon: d.armorName ? armorIcon : null, text: aTxt },
  ], PAD, by, bodyW);
  by += LH + 12;   // blank space

  // Deities — slots 1/2/3 on ONE horizontal line, each with its emoji icon (2/3 omitted if null).
  ctx.font = F(13, true);
  ctx.fillStyle = DIM_COLOR;
  ctx.fillText('Deities:', PAD, by);
  by += LH;
  ctx.font = F(15, true);
  if (d.deityName) {
    ctx.fillStyle = NAME_COLOR;
    const deitySegments = [{ icon: deityIcon, text: `${d.deityName}${d.deityEnh > 0 ? ` +${d.deityEnh}` : ''}` }];
    if (d.deity2Name) deitySegments.push({ icon: null, text: ',  ' }, { icon: deity2Icon, text: d.deity2Name });
    if (d.deity3Name) deitySegments.push({ icon: null, text: ',  ' }, { icon: deity3Icon, text: d.deity3Name });
    drawSegments(deitySegments, PAD, by, bodyW);
    by += LH;
    ctx.font = F(12);
    ctx.fillStyle = SUB_COLOR;
    ctx.fillText(fitText(ctx, `Divine Blessing: ${d.blessingName || '—'}`, bodyW), PAD, by);
    by += LH - 4;
    ctx.fillText(fitText(ctx, `Echo Blessing: ${d.echoBlessing || '—'}`, bodyW), PAD, by);
  } else {
    ctx.fillStyle = SUB_COLOR;
    ctx.fillText('None', PAD, by);
  }
  by += LH + 10;   // blank space

  // Character stats.
  ctx.font = F(13, true);
  ctx.fillStyle = DIM_COLOR;
  ctx.fillText('Character Stats:', PAD, by);
  by += LH;
  drawStatLine(ctx, PAD, by, d, bodyW);

  y = headerH + 12 + bodyH;

  /* ── SEPARATOR ──────────────────────────────────────────── */
  separator(y);
  y += 12;

  /* ── RECORDS — "Combat Record" heading + boxed cells (tighter fonts) ── */
  ctx.textAlign = 'left';
  ctx.font = F(12, true);
  ctx.fillStyle = DIM_COLOR;
  ctx.fillText('Combat Stats', PAD, y + 14);
  y += 26;

  // raidStreak = current raid win streak; the rank* cells are ranked PvP (current rank streak).
  const cells = [
    { label: 'Raids', value: d.records.raids },
    { label: 'Raids Won', value: d.records.raidsWon },
    { label: 'Raid Streak', value: d.records.raidStreak },
    { label: 'Rank Duels', value: d.records.duels },
    { label: 'Rank Wins', value: d.records.duelWins },
    { label: 'Rank Streak', value: d.records.duelStreak },
  ];
  const gap = 6;
  const cellW = (W - PAD * 2 - gap * (cells.length - 1)) / cells.length;
  const cellH = 58;
  for (let i = 0; i < cells.length; i++) {
    const cx = PAD + i * (cellW + gap);
    roundRectPath(ctx, cx, y, cellW, cellH, RADIUS);
    ctx.fillStyle = BOX;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = F(7);
    ctx.fillStyle = DIM_COLOR;
    ctx.fillText(cells[i].label.toUpperCase(), cx + cellW / 2, y + 22);
    ctx.font = F(16, true);
    ctx.fillStyle = REC_COLOR;
    ctx.fillText(String(cells[i].value), cx + cellW / 2, y + 45);
  }
  ctx.textAlign = 'left';
  y += cellH;

  /* ── SEPARATOR + FOOTER QUOTE ───────────────────────────── */
  y += 12;
  separator(y);
  y += 24;
  ctx.font = `italic ${F(13)}`;
  ctx.fillStyle = DIM_COLOR;
  ctx.textAlign = 'center';
  ctx.fillText(fitText(ctx, `“${quoteFor(d.discordId)}”`, W - PAD * 2), W / 2, y);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

/**
 * Per-stat vector glyph (sword / heart / shield / spark) drawn in the stat color.
 * Drawn as canvas paths rather than emoji — color emoji don't rasterize with the
 * bundled DejaVu font (the codebase convention). (cx, cy) is the icon center.
 */
function drawStatIcon(ctx, kind, cx, cy, s, color) {
  ctx.save();
  if (kind === 'atk') {                 // crossed swords
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - s / 2, cy + s / 2); ctx.lineTo(cx + s / 2, cy - s / 2);
    ctx.moveTo(cx + s / 2, cy + s / 2); ctx.lineTo(cx - s / 2, cy - s / 2);
    ctx.stroke();
  } else if (kind === 'hp') {            // heart
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.40);
    ctx.bezierCurveTo(cx - s * 0.55, cy - s * 0.10, cx - s * 0.45, cy - s * 0.50, cx, cy - s * 0.12);
    ctx.bezierCurveTo(cx + s * 0.45, cy - s * 0.50, cx + s * 0.55, cy - s * 0.10, cx, cy + s * 0.40);
    ctx.fill();
  } else if (kind === 'def') {           // shield
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s / 2);
    ctx.lineTo(cx + s / 2, cy - s / 3);
    ctx.lineTo(cx + s / 2, cy + s / 6);
    ctx.quadraticCurveTo(cx + s / 2, cy + s / 2, cx, cy + s / 2);
    ctx.quadraticCurveTo(cx - s / 2, cy + s / 2, cx - s / 2, cy + s / 6);
    ctx.lineTo(cx - s / 2, cy - s / 3);
    ctx.closePath();
    ctx.fill();
  } else {                               // crit — 4-point spark
    ctx.fillStyle = color;
    const o = s / 2, i = s / 6;
    ctx.beginPath();
    ctx.moveTo(cx, cy - o); ctx.lineTo(cx + i, cy - i); ctx.lineTo(cx + o, cy);
    ctx.lineTo(cx + i, cy + i); ctx.lineTo(cx, cy + o); ctx.lineTo(cx - i, cy + i);
    ctx.lineTo(cx - o, cy); ctx.lineTo(cx - i, cy - i);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** "⚔ ATK n   ❤ HP n   🛡 DEF n   ✦ CRIT n%" with colored icons + labels. */
function drawStatLine(ctx, x, y, d, maxW = Infinity) {
  const items = [
    { kind: 'atk',  label: 'ATK',  value: String(d.atk), color: STAT.atk },
    { kind: 'hp',   label: 'HP',   value: String(d.hp),  color: STAT.hp },
    { kind: 'def',  label: 'DEF',  value: String(d.def), color: STAT.def },
    { kind: 'crit', label: 'CRIT', value: `${Number(d.crit).toFixed(1)}%`, color: STAT.crit },
  ];
  let size = 14;
  let iconSize = 13;
  const totalWidth = () => {
    let w = 0;
    for (const it of items) {
      ctx.font = F(size, true);
      w += iconSize + 7 + ctx.measureText(it.label).width + 6 + ctx.measureText(it.value).width + 20;
    }
    return w;
  };
  while (size > 8 && totalWidth() > maxW) {
    size -= 1;
    iconSize = Math.max(8, iconSize - 1);
  }
  let cx = x;
  for (const it of items) {
    drawStatIcon(ctx, it.kind, cx + iconSize / 2, y - 5, iconSize, it.color);
    cx += iconSize + 7;
    ctx.font = F(size, true);
    ctx.fillStyle = it.color;
    ctx.fillText(it.label, cx, y);
    cx += ctx.measureText(it.label).width + 6;
    ctx.fillStyle = NAME_COLOR;
    ctx.fillText(it.value, cx, y);
    cx += ctx.measureText(it.value).width + Math.max(10, size + 6);
  }
}

module.exports = { renderStatsImage, quoteFor };
