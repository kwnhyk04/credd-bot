'use strict';

/**
 * BATTLE RENDER — presentation/flow layer for engine battles.
 *
 * Pure presentation: consumes a RESOLVED sim from battleEngine.resolveBattle —
 * the whole fight is decided before any message is sent. The embed starts at
 * full green HP, waits out the resolved battle duration, then edits once to
 * Victory/Defeat + a [Battle Log] button (ephemeral reply
 * with EVERY round's events, auto-paginated). The sim seed prints in the final
 * embed footer and the Battle Log header for reproduction (`crd dev battle seed <n>`).
 *
 * Canvas: @napi-rs/canvas (project standard) with the bundled DejaVu Sans family
 * (same registration as renderBagItems/weaponResultRenderer). Color emoji do NOT
 * render in node canvas on Linux, so text glyphs drawn INSIDE the panel come from
 * the DejaVu-confirmed set (★ ✦ ◆ ❖ •). Weapon/deity icons on the player card are
 * the item's CUSTOM emoji image, fetched once from the Discord CDN via the
 * game_items.txt / game_deities.txt registry (utils/emojis) and cached in-memory —
 * a missing mapping or failed fetch falls back to the ◆/❖ glyph, never crashes.
 *
 * Optional `rewards` (object — commitRewards summary: { won, credux, exp,
 * shards, chestLabel, leveledUp, levelFrom, levelTo }): rendered as a CANVAS
 * strip the SAME WIDTH as the battle panel, attached to a second embed under
 * the render on the final frame. Layout (one line each):
 *   "<Mob> defeated!" → "Rewards Obtained:" → all rewards on one line →
 *   "LEVEL UP! a → b" on its own line (only when it happened).
 * Canvas (not embed text) so the strip visually matches the battle render
 * width; credux/chest icons are the registry custom-emoji images (CDN, cached,
 * like the loadout icons), EXP/shards use DejaVu-safe glyphs.
 * Raid passes the summary; dev battle passes nothing.
 *
 * mirror: true (duel) flips fighter 2's card — name/loadout on the RIGHT, HP on
 * the LEFT, bar drains from the opposite side.
 */

const {
  EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionsBitField,
} = require('discord.js');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { emojiForDisplay, resolveName } = require('../utils/emojis');
const { getEmojiIcon } = require('./renderBagItems');
const { optimizeOpaqueAttachment, attachmentFromOptimizedImage } = require('../utils/imageOutput');
const { assertDiscordImageAttachmentsAllowed } = require('../utils/egressGuard');
const { getCachedCanvasUrl } = require('../utils/canvasCache');
const { envBool, envNumber, performanceLog } = require('../utils/runtimeLogs');
const { encodeOpaqueCanvas, releaseCanvas } = require('../utils/canvasEncode');
const { loadBattleSkin, renderBattleSkinPanel } = require('./battleLayoutRenderer');
const { loadResultSkin, renderResultPanel } = require('./resultLayoutRenderer');
const { registerMemorySource } = require('../utils/memoryRegistry');
const { beginActivity, tagDiscordAttachmentBuffer } = require('../utils/networkTelemetry');

const ROOT = path.join(__dirname, '..', '..');
const FONT = 'DejaVu Sans';
for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
  try {
    GlobalFonts.registerFromPath(path.join(ROOT, 'assets', 'fonts', file), FONT);
  } catch (err) {
    console.error(`[battleRender] font ${file} failed to register:`, err.message);
  }
}

const UPDATE_MS = 1800; // delay between embed edits (≥1500ms — rate-limit safety)

const BATTLE_FRAME_RENDER_REV = 4;
const BATTLE_RESULT_RENDER_REV = 4;
const BATTLE_FRAME_MODES = new Set(['full', 'start_and_final', 'text_only']);
const BATTLE_FRAME_COOLDOWN_MAX = 5000;
const battleFrameCooldowns = new Map();
let activeBattleCollectors = 0;

const COLORS = {
  bg: '#1f2125', card: '#26282d', cardLine: '#36393f',
  ally: '#43d675', enemy: '#f23f43', text: '#e7e9ec', dim: '#9aa0a8',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function battleFrameRenderMode() {
  const raw = String(process.env.BATTLE_FRAME_RENDER_MODE || 'start_and_final').trim().toLowerCase();
  return BATTLE_FRAME_MODES.has(raw) ? raw : 'start_and_final';
}

function battleFrameRenderCooldownMs() {
  return Math.floor(envNumber('BATTLE_FRAME_RENDER_COOLDOWN_MS', 30_000, { min: 0, max: 3_600_000 }));
}

function battleResultRenderEnabled() {
  return envBool('BATTLE_RESULT_RENDER_ENABLED', true);
}

function raidImageMaxWidth() {
  return Math.floor(envNumber('RAID_IMAGE_MAX_WIDTH', 0, { min: 0, max: 4096 }));
}

function battleImageOptions(mode) {
  return {
    background: COLORS.bg,
    quality: mode === 'raid' ? 50 : undefined,
    maxWidth: mode === 'raid' ? raidImageMaxWidth() : 1024,
  };
}

function battleFrameCooldownKey({ guildId, ownerId, mode }) {
  return [guildId || 'dm', ownerId || 'unknown', mode || 'battle'].join(':');
}

function rememberBattleFrameCooldown(key) {
  if (battleFrameCooldowns.has(key)) battleFrameCooldowns.delete(key);
  battleFrameCooldowns.set(key, Date.now());
  while (battleFrameCooldowns.size > BATTLE_FRAME_COOLDOWN_MAX) {
    battleFrameCooldowns.delete(battleFrameCooldowns.keys().next().value);
  }
}

function battlePhase(i, finalIndex) {
  if (i <= 0) return 'start';
  return i >= finalIndex ? 'final' : 'update';
}

function shouldRenderBattleFrame({ phase, guildId, ownerId, mode }) {
  const renderMode = battleFrameRenderMode();
  if (renderMode === 'text_only') {
    return { render: false, renderMode, reason: 'render-mode-text-only' };
  }
  if (renderMode === 'full') {
    return { render: true, renderMode, reason: 'render-mode-full' };
  }
  if (phase === 'start') {
    rememberBattleFrameCooldown(battleFrameCooldownKey({ guildId, ownerId, mode }));
    return { render: true, renderMode, reason: 'battle-start' };
  }
  if (phase === 'final') {
    return { render: true, renderMode, reason: 'battle-final' };
  }
  const key = battleFrameCooldownKey({ guildId, ownerId, mode });
  const last = battleFrameCooldowns.get(key) || 0;
  const cooldownMs = battleFrameRenderCooldownMs();
  if (cooldownMs > 0 && Date.now() - last < cooldownMs) {
    return { render: false, renderMode, reason: 'frame-cooldown' };
  }
  rememberBattleFrameCooldown(key);
  return { render: true, renderMode, reason: 'battle-update' };
}

/* ----------------------------------------------------------------------- */
/* CUSTOM-EMOJI ICONS: registry display name → CDN image, cached in-memory. */
/* ----------------------------------------------------------------------- */
/** Resolve + fetch the custom-emoji image for an item display name (or null). */
function getEmojiImage(displayName) {
  const name = resolveName(displayName);
  return name ? getEmojiIcon(name) : Promise.resolve(null);
}

/** Fetch all loadout icons for a sim once, before animating. */
async function prefetchIcons(sim) {
  const [aw, aa, ad, bw, ba, bd] = await Promise.all([
    getEmojiImage(sim.a.weapon), getEmojiImage(sim.a.armor), getEmojiImage(sim.a.deity),
    getEmojiImage(sim.b.weapon), getEmojiImage(sim.b.armor), getEmojiImage(sim.b.deity),
  ]);
  return { a: { weapon: aw, armor: aa, deity: ad }, b: { weapon: bw, armor: ba, deity: bd } };
}

/* ----------------------------------------------------------------------- */
/* CANVAS: the two fighter cards. mirror=true flips fighter 2 (PvP).        */
/* ----------------------------------------------------------------------- */
const PANEL_W = 640, CARD_H = 132, PAD = 14;
const ICON = 14;        // weapon/deity icon edge, sized to the 12px text line

function hpColor(p) {
  if (p > 0.5) return '#43d675';
  if (p > 0.25) return '#f0b232';
  return '#f23f43';
}

/** Trim text with an ellipsis so it fits within maxW at the current ctx.font. */
function fitText(ctx, text, maxW) {
  if (maxW <= 0 || ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Word-wrap `text` to lines that each fit within maxW at the current ctx.font ([v4.8] — the mob
 * skill line wraps instead of truncating). Splits on spaces; a single over-long word is kept on
 * its own line rather than broken. Caller must set ctx.font before measuring/drawing.
 */
function wrapText(ctx, text, maxW) {
  if (maxW <= 0) return [text];
  const lines = [];
  let cur = '';
  for (const word of String(text).split(' ')) {
    const test = cur ? `${cur} ${word}` : word;
    if (!cur || ctx.measureText(test).width <= maxW) cur = test;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

const SKILL_FONT_PX = 12;
const SKILL_LINE_H = 14; // line advance for a wrapped skill line

/** The mob's skill string (or '—'). Pure — used for both measuring and drawing. */
function skillString(f) {
  return f.skillDesc ? `Skill: ${f.skill} — ${f.skillDesc}` : `Skill: ${f.skill || '—'}`;
}

/** Extra wrapped skill lines beyond the first for a fighter card (0 for players / single-line). */
function skillExtraLines(measureCtx, f, cardW) {
  if (f.weapon) return 0; // players show a loadout, not a skill line
  measureCtx.font = `${SKILL_FONT_PX}px ${FONT}`;
  return Math.max(0, wrapText(measureCtx, skillString(f), cardW - 32).length - 1);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function clsLabel(f) {
  if (f.kind === 'player') return f.cls;
  if (f.cls === 'boss') return 'Boss';
  if (f.cls === 'elite') return 'Elite Mob';
  return 'Mob';
}

/**
 * Loadout line as [icon][name]  |  [icon][name] segments. Custom-emoji images
 * where available, ◆/❖ glyph fallback. Right-aligned (mirrored) cards read
 * Deity | Weapon — a true mirror of the left card — and compose the same
 * segments from a computed start x (canvas textAlign stays 'left' inside).
 */
function drawLoadout(ctx, f, icons, x, y, align) {
  const segs = [];
  const weaponSegs = () => {
    if (icons && icons.weapon) segs.push({ img: icons.weapon });
    else segs.push({ text: '◆' });
    segs.push({ text: ` ${f.weapon}` });
  };
  const armorSegs = () => {
    if (icons && icons.armor) segs.push({ img: icons.armor });
    else segs.push({ text: '✦' });
    segs.push({ text: ` ${f.armor}` });
  };
  const deitySegs = () => {
    if (icons && icons.deity) segs.push({ img: icons.deity });
    else segs.push({ text: '❖' });
    segs.push({ text: ` ${f.deity}` });
  };
  const sepSeg = () => segs.push({ text: '  |  ' });
  // [v5] loadout shows Weapon | Armor | Deity (mirror reverses the order).
  if (align === 'right') {
    if (f.deity) { deitySegs(); sepSeg(); }
    if (f.armor) { armorSegs(); sepSeg(); }
    weaponSegs();
  } else {
    weaponSegs();
    if (f.armor) { sepSeg(); armorSegs(); }
    if (f.deity) { sepSeg(); deitySegs(); }
  }
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = COLORS.dim;
  const width = segs.reduce(
    (w, s) => w + (s.img ? ICON : ctx.measureText(s.text).width), 0);
  let cx = align === 'right' ? x - width : x;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const s of segs) {
    if (s.img) {
      ctx.drawImage(s.img, cx, y - ICON + 3, ICON, ICON);
      cx += ICON;
    } else {
      ctx.fillText(s.text, cx, y);
      cx += ctx.measureText(s.text).width;
    }
  }
  ctx.textAlign = prevAlign;
}

function drawCard(ctx, f, state, y, { isEnemy, mirror, icons, cardH = CARD_H }) {
  const x = PAD, w = PANEL_W - PAD * 2;
  roundRect(ctx, x, y, w, cardH, 10);
  ctx.fillStyle = COLORS.card; ctx.fill();
  ctx.strokeStyle = COLORS.cardLine; ctx.lineWidth = 1.5; ctx.stroke();

  const L = x + 16, Rr = x + w - 16;
  const nameSide = mirror ? 'right' : 'left';
  const hpSide = mirror ? 'left' : 'right';
  let ty = y + 26;

  // row 1: name · class  |  hp text  (★/✦ — DejaVu-safe glyphs, no color emoji)
  const marker = isEnemy ? '✦' : '★';
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillStyle = isEnemy ? COLORS.enemy : COLORS.ally;
  ctx.textAlign = nameSide;
  const nameX = nameSide === 'left' ? L : Rr;
  const nameText = `${marker} ${f.name}${f.level ? `  Lv.${f.level}` : ''}`;
  ctx.fillText(nameText, nameX, ty);
  const nw = ctx.measureText(nameText).width;
  ctx.font = `13px ${FONT}`; ctx.fillStyle = COLORS.dim;
  ctx.fillText(`· ${clsLabel(f)}`, nameSide === 'left' ? L + nw + 8 : Rr - nw - 8, ty);

  ctx.font = `bold 14px ${FONT}`;
  ctx.fillStyle = hpColor(state.hp / state.maxHp);
  ctx.textAlign = hpSide;
  ctx.fillText(`${state.hp} / ${state.maxHp}`, hpSide === 'left' ? L : Rr, ty);
  ty += 22;

  // row 2: loadout (players) — or the mob's passive skill (for transparency) on
  // its own line, then active debuffs on the next line.
  if (f.weapon) {
    drawLoadout(ctx, f, icons, nameX, ty, nameSide);
    ty += 16;
  } else {
    // mob skill (name + description) — [v4.8] WRAP to the next line(s) instead of truncating,
    // then active debuffs. The card height was grown by the caller to fit the extra lines.
    ctx.textAlign = nameSide;
    ctx.font = `${SKILL_FONT_PX}px ${FONT}`; ctx.fillStyle = COLORS.dim;
    const skillLines = wrapText(ctx, skillString(f), w - 32);
    for (const line of skillLines) { ctx.fillText(line, nameX, ty); ty += SKILL_LINE_H; }
    ty += 1;
    const tags = (state.debuffs || []).map((d) => d.tag).join(', ');
    ctx.font = `12px ${FONT}`; ctx.fillStyle = COLORS.dim;
    ctx.fillText(`Debuffs: ${tags || 'None'}`, nameX, ty);
    ty += 16;
  }

  // hp bar (drains from the opposite side when mirrored)
  const bw = w - 32, bx = L, bh = 9, p = Math.max(0, state.hp / state.maxHp);
  roundRect(ctx, bx, ty, bw, bh, 4); ctx.fillStyle = '#3b3e44'; ctx.fill();
  if (p > 0) {
    const fillW = Math.max(bh, bw * p);
    roundRect(ctx, mirror ? bx + bw - fillW : bx, ty, fillW, bh, 4);
    ctx.fillStyle = hpColor(p); ctx.fill();
  }
  ty += 30;

  // row 3: stats — mirrored cards draw from the right edge, so iterate
  // reversed there to keep the visual reading order ATK > DEF > CRIT
  ctx.textAlign = nameSide; ctx.fillStyle = COLORS.text;
  const stats = [['ATK', f.atk], ['DEF', f.def], ['CRIT', `${Number(f.crit).toFixed(1)}%`]];
  const ordered = nameSide === 'right' ? [...stats].reverse() : stats;
  let sx = nameSide === 'left' ? L : Rr;
  for (const [k, v] of ordered) {
    ctx.font = `12px ${FONT}`;
    const kw = ctx.measureText(k + ' ').width;
    ctx.font = `bold 13px ${FONT}`;
    const vw = ctx.measureText(String(v)).width;
    if (nameSide === 'left') {
      ctx.font = `12px ${FONT}`; ctx.fillStyle = COLORS.dim; ctx.fillText(k, sx, ty);
      ctx.font = `bold 13px ${FONT}`; ctx.fillStyle = COLORS.text; ctx.fillText(String(v), sx + kw, ty);
      sx += kw + vw + 18;
    } else {
      ctx.font = `bold 13px ${FONT}`; ctx.fillStyle = COLORS.text; ctx.fillText(String(v), sx, ty);
      ctx.font = `12px ${FONT}`; ctx.fillStyle = COLORS.dim; ctx.fillText(k, sx - vw - 4, ty);
      sx -= kw + vw + 18;
    }
  }
}

/**
 * Render one snapshot frame (the two fighter cards). The result/rewards line
 * lives in the EMBED FOOTER (below the image, after Discord's separator), not
 * in the canvas — embed footers don't clip and take the mob emoji as iconURL.
 */
function renderBattlePanel(sim, snapIdx, { mirror = false, icons = null, skin = null, mode = sim.mode } = {}) {
  // Equipped skins use their own 1536x1024 art + colocated layout. A null skin
  // deliberately keeps the original generic 640px battle panel untouched.
  if (skin) {
    const skinned = renderBattleSkinPanel(sim, snapIdx, skin, { mode, icons });
    if (skinned) return skinned;
  }
  const s = sim.snapshots[Math.min(snapIdx, sim.snapshots.length - 1)];
  // [v4.8] grow a card's height when its (mob) skill line wraps, so nothing overlaps the bar/stats.
  const measureCanvas = createCanvas(8, 8);
  const measure = measureCanvas.getContext('2d');
  const cardW = PANEL_W - PAD * 2;
  let cardAH;
  let cardBH;
  try {
    cardAH = CARD_H + skillExtraLines(measure, sim.a, cardW) * SKILL_LINE_H;
    cardBH = CARD_H + skillExtraLines(measure, sim.b, cardW) * SKILL_LINE_H;
  } finally {
    releaseCanvas(measureCanvas);
  }
  const H = PAD * 3 + cardAH + cardBH;
  const canvas = createCanvas(PANEL_W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, PANEL_W, H);
  drawCard(ctx, sim.a, s.a, PAD, { isEnemy: false, mirror: false, icons: icons && icons.a, cardH: cardAH });
  drawCard(ctx, sim.b, s.b, PAD * 2 + cardAH, { isEnemy: true, mirror, icons: icons && icons.b, cardH: cardBH });
  return encodeOpaqueCanvas(canvas, { system: 'battle', imageType: 'battle_frame', command: mode });
}

/**
 * Rewards strip — same width as the battle panel, drawn under the render.
 * r = { won, credux, exp, shards, chestLabel, leveledUp, levelFrom, levelTo }.
 */
async function renderRewardsPanel(sim, r) {
  const won = sim.winner === 'a';
  const [mobImg, creduxImg, expImg, shardImg, chestImg] = await Promise.all([
    getEmojiImage(sim.b.name),
    won ? getEmojiImage('Credux Coin') : Promise.resolve(null),
    getEmojiImage('Combat Exp'),
    won ? getEmojiImage('Belief Shards') : Promise.resolve(null),
    won && r.chestLabel ? getEmojiImage(r.chestLabel) : Promise.resolve(null),
  ]);

  const LINE = 28;
  const rows = 3 + (won && r.leveledUp ? 1 : 0);
  const H = 20 + rows * LINE;
  const canvas = createCanvas(PANEL_W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, PANEL_W, H);
  ctx.textAlign = 'left';

  const X = PAD + 6;
  let y = 32;

  // row 1 — result (mob custom emoji when the registry has one)
  ctx.font = `bold 16px ${FONT}`;
  ctx.fillStyle = won ? COLORS.ally : COLORS.enemy;
  let rx = X;
  if (mobImg) {
    ctx.drawImage(mobImg, rx, y - 16, 18, 18);
    rx += 24;
  }
  ctx.fillText(won ? `${sim.b.name} defeated!` : `Defeated by ${sim.b.name}…`, rx, y);
  y += LINE;

  // row 2 — label
  ctx.font = `bold 13px ${FONT}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText('Rewards Obtained:', X, y);
  y += LINE;

  // row 3 — ALL rewards on one line (icon + value segments)
  const ICON_R = 18;
  const segs = [];
  const glyph = (g, color) => segs.push({ text: g, color });
  const text = (t, color = COLORS.text) => segs.push({ text: t, color });
  const icon = (image, fbGlyph, fbColor) =>
    (image ? segs.push({ img: image }) : glyph(fbGlyph, fbColor));
  if (won) {
    icon(creduxImg, '◉', '#f0b232');
    text(` +${r.credux.toLocaleString()} Credux`);
    text('   ·   ', COLORS.dim);
    icon(expImg, '✦', '#f0b232');
    text(` +${r.exp.toLocaleString()} EXP`);
    if (r.shards > 0) {
      text('   ·   ', COLORS.dim);
      icon(shardImg, '❖', '#b57edc');
      text(` +${r.shards} Belief Shards`);
    }
    if (r.chestLabel) {
      text('   ·   ', COLORS.dim);
      icon(chestImg, '◆', COLORS.dim);
      text(` ${r.chestLabel} ×1`);
    }
  } else {
    icon(expImg, '✦', '#f0b232');
    text(` +${r.exp.toLocaleString()} EXP`);
  }
  ctx.font = `14px ${FONT}`;
  let cx = X;
  for (const s of segs) {
    if (s.img) {
      ctx.drawImage(s.img, cx, y - ICON_R + 4, ICON_R, ICON_R);
      cx += ICON_R + 2;
    } else {
      ctx.fillStyle = s.color || COLORS.text;
      ctx.fillText(s.text, cx, y);
      cx += ctx.measureText(s.text).width;
    }
  }
  y += LINE;

  // row 4 — LEVEL UP always on its own line
  if (won && r.leveledUp) {
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillStyle = '#f0b232';
    ctx.fillText(`LEVEL UP!  ${r.levelFrom} → ${r.levelTo}`, X, y);
  }

  return encodeOpaqueCanvas(canvas, { system: 'battle', imageType: 'battle_result', command: sim.mode || 'raid' });
}

/* ----------------------------------------------------------------------- */
/* EMBEDS + ANIMATION                                                       */
/* ----------------------------------------------------------------------- */
function battleStateText(sim, snapIdx) {
  const s = sim.snapshots[Math.min(snapIdx, sim.snapshots.length - 1)];
  const line = (fighter, state) =>
    `**${fighter.name}** HP: ${Number(state.hp).toLocaleString()} / ${Number(state.maxHp).toLocaleString()}`;
  return `${line(sim.a, s.a)}\n${line(sim.b, s.b)}`;
}

function battleEmbed(sim, snapIdx, {
  mode, includeImage = true, imageUrl = null, includeStateText = false,
}) {
  const s = sim.snapshots[Math.min(snapIdx, sim.snapshots.length - 1)];
  const over = snapIdx >= sim.snapshots.length - 1;
  const playerWon = sim.winner === 'a';
  let title, color, line = null;
  if (!over) {
    title = mode === 'duel' ? '⚔️ Duel in Progress' : '⚔️ Raid Battle';
    color = 0xf0b232;
  } else if (mode === 'duel') {
    // duels are PvP — name the winner; border is keyed to the COMMAND USER
    // (the challenger, fighter a): green when they win, red when they lose
    // (one shared message can't show a different color per viewer)
    const winner = playerWon ? sim.a : sim.b;
    const loser = playerWon ? sim.b : sim.a;
    title = `🏆 ${winner.name} wins the duel!`;
    color = playerWon ? 0x43d675 : 0xf23f43;
    line = sim.outcome === 'cap_hp_pct'
      ? `⚔️ *Turn cap reached — ${winner.name} wins on remaining HP%!*`
      : `⚔️ *${winner.name} defeats ${loser.name}!*`;
  } else {
    title = playerWon ? '🏆 Victory!' : '💀 Defeated!';
    color = playerWon ? 0x43d675 : 0xf23f43;
  }
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(`Turn ${s.round} ${over ? ' ‎ **\`Battle Over\`**' : ''}`);
  if (includeStateText || (!includeImage && mode !== 'raid')) {
    e.setDescription(`${e.data.description || `Turn ${s.round}`}\n\n${battleStateText(sim, snapIdx)}`);
  }
  if (includeImage && imageUrl) e.setImage(imageUrl);
  if (over && line) e.addFields({ name: '​', value: line });
  // raid result + rewards live in a SECOND embed below this one (runBattle) —
  // fields/description here would render above the image
  // seed intentionally NOT in the embed — it stays in the Battle Log header
  return e;
}

function fighterVisualCacheParts(fighter = {}) {
  return {
    name: fighter.name,
    kind: fighter.kind,
    cls: fighter.cls,
    level: fighter.level,
    weapon: fighter.weapon,
    armor: fighter.armor,
    deity: fighter.deity,
    skill: fighter.skill,
    skillDesc: fighter.skillDesc,
    atk: fighter.atk,
    def: fighter.def,
    crit: fighter.crit,
  };
}

function snapshotSideVisualCacheParts(side = {}) {
  return {
    hp: side.hp,
    maxHp: side.maxHp,
    debuffs: (side.debuffs || []).map((debuff) => ({ tag: debuff.tag })),
  };
}

function battleFrameCacheParts(sim, snapIdx, {
  mode, mirror, battleSkinPath, battleSkinLoaded = false,
}) {
  const idx = Math.min(snapIdx, sim.snapshots.length - 1);
  const snapshot = sim.snapshots[idx] || {};
  return {
    mode,
    mirror,
    battleSkinPath: battleSkinPath || null,
    battleSkinLoaded: battleSkinPath ? Boolean(battleSkinLoaded) : null,
    fighterA: fighterVisualCacheParts(sim.a),
    fighterB: fighterVisualCacheParts(sim.b),
    snapshot: {
      round: snapshot.round,
      a: snapshotSideVisualCacheParts(snapshot.a),
      b: snapshotSideVisualCacheParts(snapshot.b),
      actions: snapshot.actions
        ? {
            a: {
              title: snapshot.actions.a?.title,
              detail: snapshot.actions.a?.detail,
            },
            b: {
              title: snapshot.actions.b?.title,
              detail: snapshot.actions.b?.detail,
            },
          }
        : null,
    },
  };
}

function resultRewardVisualCacheParts(won, rewards) {
  if (!rewards) return null;
  const visual = {
    exp: Number(rewards.exp || 0).toLocaleString(),
  };
  if (!won) return visual;
  visual.credux = Number(rewards.credux || 0).toLocaleString();
  visual.shards = Number(rewards.shards) > 0 ? String(rewards.shards) : null;
  visual.chestLabel = rewards.chestLabel ? String(rewards.chestLabel) : null;
  visual.leveledUp = Boolean(rewards.leveledUp);
  if (visual.leveledUp) {
    visual.levelFrom = String(rewards.levelFrom);
    visual.levelTo = String(rewards.levelTo);
  }
  return visual;
}

function battleResultCacheParts(sim, rewards, resultSkinPath) {
  const won = sim.winner === 'a';
  return {
    resultSkinPath: resultSkinPath || null,
    won,
    rewards: resultRewardVisualCacheParts(won, rewards),
  };
}

async function cachedBattleFrame(sim, snapIdx, {
  mode, command = mode, mirror, icons, skin, battleSkinPath, guildId, phase = 'update', ownerId = null,
}) {
  const render = () => renderBattlePanel(sim, snapIdx, { mirror, icons, skin, mode });
  const imageOptions = battleImageOptions(mode);
  const logContext = {
    system: 'battle',
    command,
    imageType: 'battle_frame',
    guildId,
    phase,
    userId: ownerId,
  };
  const cached = await getCachedCanvasUrl(
    ['battle-frame', BATTLE_FRAME_RENDER_REV, battleFrameCacheParts(sim, snapIdx, {
      mode,
      mirror,
      battleSkinPath,
      battleSkinLoaded: Boolean(skin),
    })],
    render,
    imageOptions,
    { returnImageOnFailure: true, logContext }
  );
  if (cached?.url) {
    const rendered = cached.cache === 'miss-uploaded';
    performanceLog('battle frame render decision', {
      ...logContext,
      rendered,
      reason: rendered ? 'cache-miss-uploaded' : 'cache-url',
      cacheStatus: cached.cache || 'url',
    });
    return { url: cached.url, files: [], cacheStatus: cached.cache || 'url' };
  }
  if (cached?.image) {
    const attachment = attachmentFromOptimizedImage(cached.image, 'battle', { ...logContext, reusedBuffer: true });
    const rendered = cached.cacheFailed === true;
    performanceLog('battle frame render decision', {
      ...logContext,
      rendered,
      reason: rendered ? 'cache-rendered-fallback-image' : 'cache-fallback-image',
      cacheStatus: cached.cache || 'image',
    });
    return { url: attachment.url, files: [attachment.file], cacheStatus: cached.cache || 'image' };
  }
  assertDiscordImageAttachmentsAllowed('battle frame attachment fallback', logContext);
  const image = await optimizeOpaqueAttachment(render(), 'battle', imageOptions);
  performanceLog('image output bytes', { ...logContext, bytes: image.buffer.length });
  performanceLog('battle frame render decision', {
    ...logContext,
    rendered: true,
    reason: 'attachment-fallback-render',
    cacheStatus: 'miss',
  });
  tagDiscordAttachmentBuffer(image.buffer, logContext);
  return {
    url: `attachment://${image.name}`,
    files: [new AttachmentBuilder(image.buffer, { name: image.name })],
    cacheStatus: 'miss',
  };
}

async function cachedBattleResultImage(renderBuffer, sim, rewards, resultSkinPath, {
  guildId, mode, command = mode, ownerId = null,
} = {}) {
  const imageOptions = battleImageOptions(mode);
  const logContext = {
    system: 'battle',
    command,
    imageType: 'battle_result',
    guildId,
    userId: ownerId,
    phase: 'final',
  };
  const safeRenderBuffer = async () => {
    const buffer = await renderBuffer();
    if (!buffer) throw new Error('battle result renderer returned no buffer');
    return buffer;
  };
  const cached = await getCachedCanvasUrl(
    ['battle-result-panel', BATTLE_RESULT_RENDER_REV, battleResultCacheParts(sim, rewards, resultSkinPath)],
    safeRenderBuffer,
    imageOptions,
    { returnImageOnFailure: true, logContext }
  );
  if (cached?.url) {
    const rendered = cached.cache === 'miss-uploaded';
    performanceLog('battle result render decision', {
      ...logContext,
      phase: 'final',
      rendered,
      reason: rendered ? 'cache-miss-uploaded' : 'cache-url',
      cacheStatus: cached.cache || 'url',
    });
    return { url: cached.url, files: [], cacheStatus: cached.cache || 'url' };
  }
  if (cached?.image) {
    const attachment = attachmentFromOptimizedImage(cached.image, 'rewards', { ...logContext, reusedBuffer: true });
    const rendered = cached.cacheFailed === true;
    performanceLog('battle result render decision', {
      ...logContext,
      phase: 'final',
      rendered,
      reason: rendered ? 'cache-rendered-fallback-image' : 'cache-fallback-image',
      cacheStatus: cached.cache || 'image',
    });
    return { url: attachment.url, files: [attachment.file], cacheStatus: cached.cache || 'image' };
  }
  assertDiscordImageAttachmentsAllowed('battle result attachment fallback', logContext);
  let image;
  try {
    const buffer = await safeRenderBuffer();
    image = await optimizeOpaqueAttachment(buffer, 'rewards', imageOptions);
  } catch (err) {
    console.warn('[battleRender] battle result attachment fallback:', err.message);
    performanceLog('battle result render decision', {
      ...logContext,
      phase: 'final',
      rendered: false,
      reason: 'result-render-failed',
      cacheStatus: 'failed',
    });
    return null;
  }
  performanceLog('image output bytes', { ...logContext, bytes: image.buffer.length });
  performanceLog('battle result render decision', {
    ...logContext,
    phase: 'final',
    rendered: true,
    reason: 'attachment-fallback-render',
    cacheStatus: 'miss',
  });
  tagDiscordAttachmentBuffer(image.buffer, logContext);
  return {
    url: `attachment://${image.name}`,
    files: [new AttachmentBuilder(image.buffer, { name: image.name })],
    cacheStatus: 'miss',
  };
}

function battleResultText(sim, r) {
  if (!r) return null;
  const won = sim.winner === 'a';
  return won ? `${sim.b.name} defeated!` : `Defeated by ${sim.b.name}.`;
}

function channelAllowsExternalEmojis(channel) {
  try {
    if (!channel?.guild) return true;
    const me = channel.guild.members.me
      || (channel.client?.user ? channel.guild.members.cache.get(channel.client.user.id) : null);
    const permissions = channel.permissionsFor(me || channel.client?.user);
    return permissions?.has(PermissionsBitField.Flags.UseExternalEmojis) ?? false;
  } catch {
    return false;
  }
}

function rewardIcon(displayName, fallback, allowCustomEmojis) {
  return allowCustomEmojis ? emojiForDisplay(displayName, fallback) : fallback;
}

function rewardText(sim, r, { allowCustomEmojis = false } = {}) {
  if (!r) return null;
  const won = sim.winner === 'a';
  const rewardParts = [];
  const creduxIcon = rewardIcon('Credux Coin', '🪙', allowCustomEmojis);
  const expIcon = rewardIcon('Combat Exp', '✨', allowCustomEmojis);
  const shardIcon = rewardIcon('Belief Shards', '🔮', allowCustomEmojis);

  if (won) {
    rewardParts.push(`${creduxIcon} +${Number(r.credux || 0).toLocaleString()} Credux`);
    rewardParts.push(`${expIcon} +${Number(r.exp || 0).toLocaleString()} EXP`);
    if (Number(r.shards || 0) > 0) rewardParts.push(`${shardIcon} +${Number(r.shards).toLocaleString()} Belief Shards`);
    if (r.chestLabel) rewardParts.push(`${rewardIcon(r.chestLabel, '🎁', allowCustomEmojis)} ${r.chestLabel} x1`);
    if (r.leveledUp) rewardParts.push(`⬆️ LEVEL UP! ${r.levelFrom} -> ${r.levelTo}`);
  } else {
    rewardParts.push(`${expIcon} +${Number(r.exp || 0).toLocaleString()} EXP`);
  }

  return `Rewards Obtained:\n${rewardParts.join(' · ')}`;
}

function buttons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('battle_log').setLabel('Battle Log').setEmoji('📋').setStyle(ButtonStyle.Secondary),
  );
}

function logEmbeds(sim) {
  // every single round — the per-turn detail the 3-turn embed skips
  const sections = sim.rounds.map((r) => `**— TURN ${r.round} —**\n${r.events.join('\n')}`);
  const pages = [];
  let buf = `-# Seed: \`${sim.seed}\` · ${sim.rounds.length} turns · winner: ${sim.winner === 'a' ? sim.a.name : sim.b.name}`;
  for (const sec of sections) {
    if (buf.length + sec.length > 3800) { pages.push(buf); buf = ''; }
    buf += (buf ? '\n\n' : '') + sec;
  }
  if (buf) pages.push(buf);
  return pages.map((d, i) =>
    new EmbedBuilder().setColor(0x2b2d31)
      .setTitle(i === 0 ? '📋 Full Battle Log' : '📋 Full Battle Log (cont.)')
      .setDescription(d));
}

function isDiscordErrorCode(err, code) {
  return err?.code === code || err?.rawError?.code === code;
}

/**
 * Entry point — animates an already-resolved sim.
 * @param {import('discord.js').TextBasedChannel} channel
 * @param {object} opts
 * @param {'raid'|'duel'|'boss'} opts.mode  duel mirrors fighter 2's card
 * @param {object} opts.sim                 battleEngine.resolveBattle output
 * @param {object} [opts.rewards]           commitRewards summary for the
 *                                          rewards strip (raid; dev battle
 *                                          omits it) — see header comment
 * @param {Function} [opts.onMessage]       async (msg) — called once with the
 *                                          battle message right after the first
 *                                          frame is sent (active_battles row
 *                                          message_id update). Errors swallowed.
 * @param {string[]} [opts.notices]         completion lines (e.g. daily-quest grants)
 *                                          shown as the message content on the FINAL
 *                                          frame only. No-op when empty.
 */
async function runBattleImpl(channel, {
  mode, sim, rewards = null, onMessage = null, notices = [], footer = null, header = null,
  battleSkinPath = null, resultSkinPath = null, ownerId = null, telemetryCommand = mode,
}) {
  const mirror = mode === 'duel';
  const resultImageEnabled = battleResultRenderEnabled();
  const showRaidRewards = mode === 'raid';
  const showResultPanel = showRaidRewards && resultImageEnabled;
  const battleOwnerId = ownerId || sim.a.discordId || sim.a.userId || sim.a.id || sim.a.name || null;
  const guildId = channel.guild?.id || null;
  // STRICT outcome: resultSkinPath is the victory OR defeated canvas already
  // chosen by the caller (resolveSkin variant) — never both. A null/invalid
  // result skin falls through to the generic rewards strip below.
  // Preserve the original timing: resolve all visual assets before the opening
  // message, then only encode the result Canvas at completion.
  let [icons, skin, resultSkin] = await Promise.all([
    prefetchIcons(sim).catch(() => null),
    loadBattleSkin(battleSkinPath),
    showResultPanel ? loadResultSkin(resultSkinPath) : Promise.resolve(null),
  ]);
  let resultEmbed = null;
  let renderRewardsBuffer = null;
  if (showResultPanel && resultSkin) {
    renderRewardsBuffer = () => renderResultPanel(sim, rewards, resultSkin, { loadIcon: getEmojiImage })
      .catch((err) => {
        console.warn('[battleRender] result skin panel:', err.message);
        return null;
      });
    resultEmbed = new EmbedBuilder()
      .setColor(sim.winner === 'a' ? 0x43d675 : 0xf23f43);
  }
  const fallbackResultText = showRaidRewards && rewards != null
    ? battleResultText(sim, rewards)
    : null;
  const allowCustomRewardEmojis = channelAllowsExternalEmojis(channel);
  const fallbackRewardText = showRaidRewards && rewards != null
    ? rewardText(sim, rewards, { allowCustomEmojis: allowCustomRewardEmojis })
    : null;
  if (showRaidRewards && rewards != null && !resultImageEnabled) {
    performanceLog('battle result render decision', {
      system: 'battle',
      command: mode,
      imageType: 'battle_result',
      guildId,
      userId: battleOwnerId,
      phase: 'final',
      rendered: false,
      renderMode: battleFrameRenderMode(),
      reason: 'result-render-disabled',
    });
  }

  const noticeLine = notices.length ? notices.join('\n') : null;
  const finalIndex = sim.snapshots.length - 1;

  const frame = async (i) => {
    const over = i >= finalIndex;
    const phase = battlePhase(i, finalIndex);
    const wantsRewardsVisual = Boolean(over && resultEmbed && renderRewardsBuffer);

    const frameDecision = shouldRenderBattleFrame({
      phase,
      guildId,
      ownerId: battleOwnerId,
      mode,
    });
    // Keep the command's original Canvas sequence. Compression and cache reuse
    // reduce bytes without removing the opening or final battle image.
    let battleImage = { url: null, files: [], cacheStatus: 'skipped' };
    if (frameDecision.render) {
      battleImage = await cachedBattleFrame(sim, i, {
        mode,
        command: telemetryCommand,
        mirror,
        icons,
        skin,
        battleSkinPath,
        guildId,
        phase,
        ownerId: battleOwnerId,
      });
    } else {
      performanceLog('battle frame render decision', {
        system: 'battle',
        command: telemetryCommand,
        imageType: 'battle_frame',
        guildId,
        userId: battleOwnerId,
        phase,
        rendered: false,
        renderMode: frameDecision.renderMode,
        reason: frameDecision.reason,
        skipReason: frameDecision.reason,
        cacheStatus: 'skipped',
      });
    }

    let rewardsImage = null;
    if (wantsRewardsVisual) {
      try {
        rewardsImage = await cachedBattleResultImage(
          renderRewardsBuffer,
          sim,
          rewards,
          resultSkinPath,
          { guildId, mode, command: telemetryCommand, ownerId: battleOwnerId }
        );
      } catch (err) {
        console.warn('[battleRender] final result image unavailable; using reward text:', err.message);
      }
    }
    if (rewardsImage) resultEmbed.setImage(rewardsImage.url);
    const includeImage = Boolean(battleImage.url);
    const base = battleEmbed(sim, i, {
      mode,
      includeImage,
      imageUrl: battleImage.url,
      // Text-only progress/fallbacks must retain the fighter/HP information
      // that the omitted visual previously carried.
      includeStateText: !includeImage,
    });
    // Phase 6: ranked threads its result into the embed — the tier matchup in the
    // HEADER (author, top), the outcome + rating move + Valor in the FOOTER (bottom).
    if (over && header) base.setAuthor({ name: header });
    if (over && footer) base.setFooter({ text: footer });
    const defaultResultText = !renderRewardsBuffer ? fallbackResultText : null;
    const defaultRewardText = !renderRewardsBuffer ? fallbackRewardText : null;
    const resultTextForFrame = over
      && (defaultResultText || (wantsRewardsVisual && !rewardsImage ? fallbackResultText : null));
    const rewardTextForFrame = over
      && (defaultRewardText || (wantsRewardsVisual && !rewardsImage ? fallbackRewardText : null));
    if (resultTextForFrame) {
      base.addFields({ name: '\u200b', value: resultTextForFrame });
    }
    const rewardTextEmbed = rewardTextForFrame
      ? new EmbedBuilder()
        .setColor(sim.winner === 'a' ? 0x43d675 : 0xf23f43)
        .setDescription(rewardTextForFrame)
      : null;
    const files = [
      ...battleImage.files,
      ...(rewardsImage ? rewardsImage.files : []),
    ];
    const embeds = [base];
    if (rewardsImage) embeds.push(resultEmbed);
    if (rewardTextEmbed) embeds.push(rewardTextEmbed);
    const payload = {
      content: over && noticeLine ? noticeLine : '',
      embeds,
      files,
      attachments: [],
      components: over ? [buttons()] : [],
    };
    return payload;
  };

  let msg = await channel.send({ ...(await frame(0)), attachments: undefined });
  if (onMessage) {
    try { await onMessage(msg); } catch (err) { console.warn('[battleRender] onMessage:', err.message); }
  }
  if (finalIndex > 0) {
    await sleep(UPDATE_MS * finalIndex);
    const finalPayload = await frame(finalIndex);
    try {
      await msg.edit(finalPayload);
    } catch (err) {
      if (!isDiscordErrorCode(err, 50013)) throw err;
      console.warn('[battleRender] Final battle edit blocked by Discord permissions; sending final frame as a new message.');
      // Preserve the Canvas result on the rare permission fallback too. Normal
      // successful edits still upload each attachment only once.
      msg = await channel.send({ ...finalPayload, attachments: undefined });
      if (onMessage) {
        try { await onMessage(msg); } catch (onMessageErr) { console.warn('[battleRender] onMessage:', onMessageErr.message); }
      }
    }
  }

  // The collector only needs the text log and message. Drop final-render
  // references before its five-minute lifetime begins so decoded skins/icons
  // cannot be retained by this battle scope.
  icons = null;
  skin = null;
  resultSkin = null;
  resultEmbed = null;
  renderRewardsBuffer = null;

  const battleLogPages = logEmbeds(sim);
  const collector = msg.createMessageComponentCollector({ time: 300_000 });
  activeBattleCollectors += 1;
  collector.on('collect', async (i) => {
    try {
      if (i.customId === 'battle_log') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await i.editReply({ embeds: battleLogPages.slice(0, 10) });
        for (let p = 10; p < battleLogPages.length; p += 10) {
          await i.followUp({ embeds: battleLogPages.slice(p, p + 10), flags: MessageFlags.Ephemeral });
        }
      }
    } catch (err) {
      if (isDiscordErrorCode(err, 10062)) return;
      console.error('[battleRender] button error:', err.message);
      if (i.customId === 'battle_log' && (i.deferred || i.replied)) {
        await i.editReply({ content: 'Could not load the battle log right now.' }).catch(() => {});
      }
    }
  });
  collector.once('end', () => {
    activeBattleCollectors = Math.max(0, activeBattleCollectors - 1);
    msg.edit({ components: [] }).catch(() => {});
  });

  return sim;
}

async function runBattle(channel, options) {
  const endActivity = beginActivity(`battle.${options?.telemetryCommand || options?.mode || 'unknown'}`);
  try {
    return await runBattleImpl(channel, options);
  } finally {
    endActivity();
  }
}

registerMemorySource('battle.runtime', () => ({
  cooldownEntries: battleFrameCooldowns.size,
  cooldownMaxEntries: BATTLE_FRAME_COOLDOWN_MAX,
  activeCollectors: activeBattleCollectors,
}));

module.exports = {
  runBattle,
  renderBattlePanel,
  renderRewardsPanel,
  battleEmbed,
  logEmbeds,
  battleFrameCacheParts,
  battleResultCacheParts,
  battlePhase,
  shouldRenderBattleFrame,
  UPDATE_MS,
};
