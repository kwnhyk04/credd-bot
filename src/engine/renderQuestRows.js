'use strict';

/**
 * renderQuestRows.js — canvas-rendered quest rows for `crd quests` (Master §20).
 *
 * Same boxed-row visual language as `crd bag chests` (renderBagItems): one rounded dark
 * box per quest. Each box is two lines: the quest name + a status glyph (right-aligned),
 * then a progress bar (▓▓▓░░ X/Y) and the reward with the credux / belief-shard icons
 * (CDN emoji art, disk-cached via renderBagItems.getEmojiIcon).
 */

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const { getEmojiIcon, FONT_FAMILY } = require('./renderBagItems');

const ROOT = path.join(__dirname, '..', '..');
for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
  try {
    GlobalFonts.registerFromPath(path.join(ROOT, 'assets', 'fonts', file), FONT_FAMILY);
  } catch { /* already registered by renderBagItems */ }
}

// Per-type quest icons live in `assets/quest icons/` (PNG; loaded from disk, cached).
const QUEST_ICON_DIR = path.join(ROOT, 'assets', 'quest icons');
const QUEST_ICON_FILE = {
  raid_wins: 'quest_raid.png',
  elite_defeats: 'quest_raid.png',
  credux_spent: 'quest_spend.png',
  weapon_enhancements: 'quest_enhance.png',
  duel_wins: 'quest_duel.png',
  duel_challenges: 'quest_duel.png',
};
const questIconCache = new Map(); // type → Image | null
async function getQuestIcon(type) {
  if (questIconCache.has(type)) return questIconCache.get(type);
  const file = path.join(QUEST_ICON_DIR, QUEST_ICON_FILE[type] || 'quest_icon.png');
  let img = null;
  try { if (fs.existsSync(file)) img = await loadImage(file); }
  catch (err) { console.error(`[renderQuestRows] icon '${type}' failed:`, err.message); }
  questIconCache.set(type, img);
  return img;
}

// Layout
const W = 560;
const ROW_H = 70;
const GAP = 10;
const PAD = 12;
const RADIUS = 12;
const ICON = 20;
const BAR_SEGMENTS = 10;

// Colors (near Discord dark)
const BG = '#1E1F22';
const BOX = '#26272D';
const NAME_COLOR = '#FFFFFF';
const SUB_COLOR = '#B5B8BE';
const BAR_FILL = '#43d675';
const BAR_EMPTY = '#3A3C43';
const DONE_COLOR = '#43d675';
const PROG_COLOR = '#f0b232';

// Typography
const NAME_FONT = `bold 16px "${FONT_FAMILY}"`;
const SUB_FONT = `14px "${FONT_FAMILY}"`;
const STATUS_FONT = `15px "${FONT_FAMILY}"`;

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/** ▓▓▓░░-style filled bar drawn as rounded segments. */
function drawBar(ctx, x, y, w, h, ratio) {
  const filled = Math.round(ratio * BAR_SEGMENTS);
  const segW = (w - (BAR_SEGMENTS - 1) * 3) / BAR_SEGMENTS;
  for (let i = 0; i < BAR_SEGMENTS; i++) {
    ctx.fillStyle = i < filled ? BAR_FILL : BAR_EMPTY;
    roundRectPath(ctx, x + i * (segW + 3), y, segW, h, 2);
    ctx.fill();
  }
}

/**
 * @param {Array<{name, current, target, rewardCredux, rewardShards, completed}>} quests
 * @returns {Promise<Buffer>} PNG
 */
async function renderQuestRowsImage(quests) {
  const H = PAD * 2 + quests.length * ROW_H + (quests.length - 1) * GAP;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const creduxIcon = await getEmojiIcon('credux_coin');
  const shardIcon = await getEmojiIcon('belief_shards');
  const typeIcons = await Promise.all(quests.map((q) => getQuestIcon(q.type)));

  const TYPE_ICON = 34;
  for (let i = 0; i < quests.length; i++) {
    const q = quests[i];
    const y = PAD + i * (ROW_H + GAP);
    const iconX = PAD + 12;
    const textX = iconX + TYPE_ICON + 12;
    const innerR = W - PAD - 14;

    roundRectPath(ctx, PAD, y, W - PAD * 2, ROW_H, RADIUS);
    ctx.fillStyle = BOX;
    ctx.fill();

    // per-type quest icon (left, vertically centered)
    const ti = typeIcons[i];
    if (ti) ctx.drawImage(ti, iconX, y + (ROW_H - TYPE_ICON) / 2, TYPE_ICON, TYPE_ICON);

    // Line 1: "Q# · name" (left) + status glyph (right)
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = NAME_FONT;
    ctx.fillStyle = PROG_COLOR;
    const label = `Q${i + 1}`;
    ctx.fillText(label, textX, y + 24);
    const lw = ctx.measureText(label).width;
    ctx.fillStyle = NAME_COLOR;
    ctx.fillText(`  ${q.name}`, textX + lw, y + 24);

    ctx.textAlign = 'right';
    ctx.font = STATUS_FONT;
    ctx.fillStyle = q.completed ? DONE_COLOR : PROG_COLOR;
    ctx.fillText(q.completed ? '✓ Done' : '↻ In progress', innerR, y + 24);

    // Line 2: progress bar + X/Y, then reward icons at the right
    const ratio = q.target > 0 ? Math.min(1, q.current / q.target) : 0;
    const barY = y + 40;
    const barW = 150;
    drawBar(ctx, textX, barY, barW, 12, ratio);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = SUB_FONT;
    ctx.fillStyle = SUB_COLOR;
    const progText = `${q.current.toLocaleString()}/${q.target.toLocaleString()}`;
    ctx.fillText(progText, textX + barW + 10, barY + 6);

    // Reward, right-aligned: <icon> N  <icon> N
    const midY = barY + 6;
    let rx = innerR;
    // shards (rightmost)
    ctx.textAlign = 'right';
    ctx.fillStyle = SUB_COLOR;
    const shardText = `${q.rewardShards}`;
    ctx.fillText(shardText, rx, midY);
    rx -= ctx.measureText(shardText).width + 4;
    if (shardIcon) { ctx.drawImage(shardIcon, rx - ICON, midY - ICON / 2, ICON, ICON); rx -= ICON + 10; }
    // credux
    const creduxText = q.rewardCredux.toLocaleString();
    ctx.fillText(creduxText, rx, midY);
    rx -= ctx.measureText(creduxText).width + 4;
    if (creduxIcon) ctx.drawImage(creduxIcon, rx - ICON, midY - ICON / 2, ICON, ICON);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
}

module.exports = { renderQuestRowsImage };
