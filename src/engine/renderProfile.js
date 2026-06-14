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

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { getEmojiIcon, FONT_FAMILY } = require('./renderBagItems');
const { resolveName } = require('../utils/emojis');

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
  // Pre-fetch images (avatar + weapon/deity/combat-exp icons) before laying out.
  const [avatar, weaponIcon, deityIcon, expIcon] = await Promise.all([
    loadAvatar(d.avatarUrl, d.fallbackAvatarUrl),
    d.weaponName ? getEmojiIcon(resolveName(d.weaponName) || '') : Promise.resolve(null),
    d.deityName ? getEmojiIcon(resolveName(d.deityName) || '') : Promise.resolve(null),
    getEmojiIcon('combat_exp'),
  ]);

  // ── Measure total height (header + body + records + footer) ──
  const headerH = PAD + AVATAR + 14;
  const bodyH = 230;            // class, combat-exp, weapon hdr+val, deity hdr+val+blessing, stats hdr+val
  const recordsH = 110;         // "Combat Record" heading + boxed cells
  const footerH = 30;
  const H = headerH + 12 + bodyH + 12 + recordsH + 12 + footerH;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
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
    { label: 'Duels', value: d.records.duels },
    { label: 'Duel Wins', value: d.records.duelWins },
  ];
  const gap = 12;
  const cellW = (W - PAD * 2 - gap * (cells.length - 1)) / cells.length;
  const cellH = 58;
  for (let i = 0; i < cells.length; i++) {
    const cx = PAD + i * (cellW + gap);
    roundRectPath(ctx, cx, y, cellW, cellH, RADIUS);
    ctx.fillStyle = BOX;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = F(9);
    ctx.fillStyle = DIM_COLOR;
    ctx.fillText(cells[i].label.toUpperCase(), cx + cellW / 2, y + 22);
    ctx.font = F(19, true);
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
