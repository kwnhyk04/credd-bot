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
const { hasProfileLayout, renderProfileLayoutImage } = require('./profileLayoutRenderer');
const { resolveName } = require('../utils/emojis');

/* ── Background template ([v4.6]) ───────────────────────────────────────────
 * The profile card is drawn on top of a template image. TEMPLATE_FILE is a single
 * swappable constant — the planned SUPPORTER phase will pick a per-user template
 * (believer_/cbeliever_/eternal_) without restructuring this renderer. A faint scrim
 * keeps text legible over arbitrary art. If the template is missing, fall back to the
 * old flat dark background at the native 600-wide layout. */
const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'assets', 'profile');
const TEMPLATE_FILE = 'default_template.png';
const SCRIM = 'rgba(18,19,22,0.50)';
let templateCache;
function loadTemplate() {
  if (templateCache === undefined) {
    templateCache = loadImage(path.join(TEMPLATE_DIR, TEMPLATE_FILE)).catch(() => null);
  }
  return templateCache;
}

/* ── Layout ─────────────────────────────────────────────────────────────── */
const W = 600;
const PAD = 22;
const AVATAR = 96;
const RADIUS = 12;

/* ── Colors (near Discord dark, matching the bag/quest renders) ─────────── */
const BG = '#1E1F22';
const BOX = '#26272D';
const ACCENT = '#9b59b6';
const NAME_COLOR = '#FFFFFF';
const SUB_COLOR = '#B5B8BE';
const DIM_COLOR = '#8E919A';
const BAR_EMPTY = '#3A3C43';
const EXP_FILL = '#9b59b6';

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

/** Horizontal progress bar (rounded track + fill). */
function drawProgress(ctx, x, y, w, h, ratio, fill) {
  const r = h / 2;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = BAR_EMPTY;
  ctx.fill();
  const fw = Math.max(0, Math.min(1, ratio)) * w;
  if (fw > 0) {
    roundRectPath(ctx, x, y, Math.max(fw, h), h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

/** Avatar fetch with graceful fallback to the default Discord avatar. */
async function loadAvatar(avatarUrl, fallbackUrl) {
  for (const url of [avatarUrl, fallbackUrl]) {
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (res.ok) return await loadImage(Buffer.from(await res.arrayBuffer()));
    } catch { /* try next */ }
  }
  return null;
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
async function renderProfileImage(d) {
  // Supporter/tester/founder skins with colocated layout configs use the exact same
  // data-driven renderer as the design previews. Skins without a config retain the
  // original profile layout below.
  if (hasProfileLayout(d.skinPath)) {
    try {
      return await renderProfileLayoutImage({ ...d, quote: `"${quoteFor(d.discordId)}"` });
    } catch (err) {
      console.error(`[profile] layout render failed for ${path.basename(d.skinPath)}:`, err);
    }
  }

  // Pre-fetch images (frame + avatar + weapon/deity/combat-exp icons) before laying out.
  // [Supporter-stage §6] When a profile skin resolves (d.skinPath), it replaces the default
  // template as the bottom layer; otherwise fall back to the shared default template.
  const [template, avatar, weaponIcon, armorIcon, deityIcon, expIcon] = await Promise.all([
    d.skinPath ? loadImage(d.skinPath).catch(() => null).then((img) => img || loadTemplate()) : loadTemplate(),
    loadAvatar(d.avatarUrl, d.fallbackAvatarUrl),
    d.weaponName ? getEmojiIcon(resolveName(d.weaponName) || '') : Promise.resolve(null),
    d.armorName ? getEmojiIcon(resolveName(d.armorName) || '') : Promise.resolve(null),
    d.deityName ? getEmojiIcon(resolveName(d.deityName) || '') : Promise.resolve(null),
    getEmojiIcon('combat_exp'),
  ]);

  // ── Measure the layout (600-wide design space) ──
  const headerH = PAD + AVATAR + 14;
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
  // Avatar (squared, rounded) on the right.
  const ax = W - PAD - AVATAR;
  const ay = y;
  ctx.save();
  roundRectPath(ctx, ax, ay, AVATAR, AVATAR, 16);
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, ax, ay, AVATAR, AVATAR);
  } else {
    ctx.fillStyle = BOX;
    ctx.fillRect(ax, ay, AVATAR, AVATAR);
  }
  ctx.restore();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  roundRectPath(ctx, ax, ay, AVATAR, AVATAR, 16);
  ctx.stroke();

  const leftW = ax - PAD - 16; // text column width (clears the avatar)

  // Line 1: display name.
  ctx.textAlign = 'left';
  ctx.font = F(26, true);
  ctx.fillStyle = NAME_COLOR;
  ctx.fillText(fitText(ctx, d.displayName, leftW), PAD, y + 26);

  // Line 2: Believer level + rank title.
  ctx.font = F(15, true);
  ctx.fillStyle = ACCENT;
  ctx.fillText(
    fitText(ctx, `Believer Level ${d.believerLevel} · ${d.believerTitle}`, leftW),
    PAD,
    y + 50
  );

  // Line 3: Believer EXP number + bar.
  ctx.font = F(12);
  ctx.fillStyle = SUB_COLOR;
  const bExp = `${Number(d.believerExp).toLocaleString()} / ${Number(d.believerExpMax).toLocaleString()} EXP`;
  ctx.fillText(bExp, PAD, y + 70);
  drawProgress(ctx, PAD, y + 78, leftW, 10, d.believerExp / d.believerExpMax, EXP_FILL);

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

  /* ── BODY ───────────────────────────────────────────────── */
  let by = y + 18;
  const LH = 22;

  // Class + combat level.
  ctx.font = F(16, true);
  ctx.fillStyle = NAME_COLOR;
  ctx.fillText(`Character Class: ${d.className}, Lvl ${d.combatLevel}`, PAD, by);
  by += LH;

  // Combat EXP — single text line with the combat-exp icon, no bar.
  let cex = PAD;
  if (expIcon) { ctx.drawImage(expIcon, cex, by - 13, 15, 15); cex += 19; }
  ctx.font = F(13);
  ctx.fillStyle = SUB_COLOR;
  const needed = d.combatExpMax == null ? 'MAX' : Number(d.combatExpMax).toLocaleString();
  ctx.fillText(`Combat EXP: ${Number(d.combatExp).toLocaleString()} / ${needed}`, cex, by);
  by += LH + 8;

  // Weapon.
  ctx.font = F(13, true);
  ctx.fillStyle = DIM_COLOR;
  ctx.fillText('Weapon:', PAD, by);
  by += LH;
  ctx.font = F(15, true);
  ctx.fillStyle = NAME_COLOR;
  if (d.weaponName) {
    let wx = PAD;
    if (weaponIcon) { ctx.drawImage(weaponIcon, wx, by - 15, 18, 18); wx += 24; }
    const enh = d.weaponEnh > 0 ? ` +${d.weaponEnh}` : '';
    ctx.fillText(fitText(ctx, `${d.weaponName}${enh}`, W - PAD - wx), wx, by);
  } else {
    ctx.fillStyle = SUB_COLOR;
    ctx.fillText('None', PAD, by);
  }
  by += LH + 8;

  // Armor ([v5]) — mirrors the weapon block: emoji + name +enh (type).
  ctx.font = F(13, true);
  ctx.fillStyle = DIM_COLOR;
  ctx.fillText('Armor:', PAD, by);
  by += LH;
  ctx.font = F(15, true);
  if (d.armorName) {
    let ax = PAD;
    if (armorIcon) { ctx.drawImage(armorIcon, ax, by - 15, 18, 18); ax += 24; }
    ctx.fillStyle = NAME_COLOR;
    const enh = d.armorEnh > 0 ? ` +${d.armorEnh}` : '';
    // [v5 tweak] Armor type ("(Medium)") no longer shown.
    ctx.fillText(fitText(ctx, `${d.armorName}${enh}`, W - PAD - ax), ax, by);
  } else {
    ctx.fillStyle = SUB_COLOR;
    ctx.fillText('None', PAD, by);
  }
  by += LH + 8;

  // Active deity — mirrors the weapon block: emoji + name +enh, then a Blessing: line.
  ctx.font = F(13, true);
  ctx.fillStyle = DIM_COLOR;
  ctx.fillText('Active Deity:', PAD, by);
  by += LH;
  if (d.deityName) {
    let dx = PAD;
    if (deityIcon) { ctx.drawImage(deityIcon, dx, by - 15, 18, 18); dx += 24; }
    ctx.font = F(15, true);
    ctx.fillStyle = NAME_COLOR;
    const enh = d.deityEnh > 0 ? ` +${d.deityEnh}` : '';
    ctx.fillText(fitText(ctx, `${d.deityName}${enh}`, W - PAD - dx), dx, by);
    by += LH - 2;
    ctx.font = F(12);
    ctx.fillStyle = SUB_COLOR;
    ctx.fillText(fitText(ctx, `Blessing: ${d.blessingName || '—'}`, W - PAD * 2), PAD, by);
  } else {
    ctx.font = F(15, true);
    ctx.fillStyle = SUB_COLOR;
    ctx.fillText('None', PAD, by);
  }
  by += LH + 8;

  // Character stats.
  ctx.font = F(13, true);
  ctx.fillStyle = DIM_COLOR;
  ctx.fillText('Character Stats:', PAD, by);
  by += LH;
  drawStatLine(ctx, PAD, by, d);

  y = headerH + 12 + bodyH;

  /* ── SEPARATOR ──────────────────────────────────────────── */
  separator(y);
  y += 12;

  /* ── RECORDS — "Combat Record" heading + boxed cells (tighter fonts) ── */
  ctx.textAlign = 'left';
  ctx.font = F(12, true);
  ctx.fillStyle = DIM_COLOR;
  ctx.fillText('Combat Record', PAD, y + 14);
  y += 26;

  const cells = [
    { label: 'Raids', value: d.records.raids },
    { label: 'Raids Won', value: d.records.raidsWon },
    { label: 'Raid Streak', value: d.records.raidStreak },
    { label: 'Duels', value: d.records.duels },
    { label: 'Duel Wins', value: d.records.duelWins },
    { label: 'Duel Streak', value: d.records.duelStreak },
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
function drawStatLine(ctx, x, y, d) {
  const items = [
    { kind: 'atk',  label: 'ATK',  value: String(d.atk), color: STAT.atk },
    { kind: 'hp',   label: 'HP',   value: String(d.hp),  color: STAT.hp },
    { kind: 'def',  label: 'DEF',  value: String(d.def), color: STAT.def },
    { kind: 'crit', label: 'CRIT', value: `${Number(d.crit).toFixed(1)}%`, color: STAT.crit },
  ];
  const S = 13;
  let cx = x;
  for (const it of items) {
    drawStatIcon(ctx, it.kind, cx + S / 2, y - 5, S, it.color);
    cx += S + 7;
    ctx.font = F(14, true);
    ctx.fillStyle = it.color;
    ctx.fillText(it.label, cx, y);
    cx += ctx.measureText(it.label).width + 6;
    ctx.fillStyle = NAME_COLOR;
    ctx.fillText(it.value, cx, y);
    cx += ctx.measureText(it.value).width + 20;
  }
}

module.exports = { renderProfileImage, quoteFor };
