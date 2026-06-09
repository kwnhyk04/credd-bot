/**
 * renderSummon.js — COMPLETE summon display module
 *
 * Exports:
 *   1. renderSummonGrid(results)            → PNG buffer of the card grid
 *   2. buildFlipMessage()                   → phase-1 payload (spinning card GIF)
 *   3. buildResultMessage(results, balances)→ phase-2 payload (full result container)
 *   4. flipGifExists()                      → guard: phase 1 needs the GIF on disk
 *
 * Flow in the command:  reply(buildFlipMessage()) → sleep(3000) →
 *                       edit(await buildResultMessage(results, balances))
 *
 * Requires: discord.js v14.19+, @napi-rs/canvas
 * Assets (relative to project root):
 *   assets/animations/gacha/card_remnant|awakened|undying|primordial.png  (rarity frames)
 *   assets/animations/gacha/card_flipping.gif                            (phase-1 suspense)
 */

const {
  ContainerBuilder,
  AttachmentBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const { emoji, BELIEF_SHARDS_ICON } = require('../utils/emojis');
const { getEmojiIcon } = require('./renderBagItems');
const { TIER_ALIAS, TIER_ESSENCE_COLUMN } = require('../config/gachaRates');

// rarity alias → essence emoji name, derived from the ACTUAL duplicate-conversion
// constants (summonEngine credits TIER_ESSENCE_COLUMN[tier] on a dupe; TIER_ALIAS
// maps tier → the display alias renderSummon receives). Fallback: epic_essence.
const ALIAS_TO_ESSENCE = Object.fromEntries(
  Object.entries(TIER_ALIAS).map(([tier, alias]) => [alias, TIER_ESSENCE_COLUMN[tier]])
);

/* ════════════════════════════════════════════
 * CONFIG
 * ══════════════════════════════════════════ */
const ACCENT = 0xf0b232;
// Anchored to the project root (this file is src/engine/), not process.cwd().
const ROOT = path.join(__dirname, '..', '..');
const FLIP_GIF_PATH = path.join(ROOT, 'assets', 'animations', 'gacha', 'card_flip.gif');
// The 1024×1024 rarity frames live with the gacha animation assets (§35.7).
const CARDS_DIR = path.join(ROOT, 'assets', 'animations', 'gacha');

const FRAME_FILES = {
  Remnant:    'card_remnant.png',
  Awakened:   'card_awakened.png',
  Undying:    'card_undying.png',
  Primordial: 'card_primordial.png',
};

const NAME_COLORS = {
  Remnant:    '#8C9BF5',
  Awakened:   '#C4A9F8',
  Undying:    '#F5CB6B',
  Primordial: '#F49B9B',
};

const RARITY_SYMBOLS = {
  Remnant: '◆',
  Awakened: '❖',
  Undying: '★',
  Primordial: '✦',
};

const FLAVOR = {
  1:  'A forgotten god has answered your call. Their power flows into you.',
  5:  'The veil thins. Five forgotten souls answer the call of the Last Believer.',
  10: 'The heavens fracture. Ten forgotten souls answer the call of the Last Believer.',
};

// Measured from the rarity frame PNGs — uniform crop fitting the largest glow
const SRC = { x: 160, y: 45, w: 710, h: 910 };
const LAYOUTS = {
  1:  { cols: 1, cardW: 340 },
  5:  { cols: 5, cardW: 190 },
  10: { cols: 5, cardW: 190 },
};
const GAP = 14;
const PAD = 22;
const BG = '#0E0F13';

// Text placement: upper-middle, reduced sizes
const TEXT_Y = 0.30;        // fraction of card height for the name line
const NAME_FONT_SCALE = 0.085;
const RARITY_FONT_SCALE = 0.055;

/** Phase 1 needs the flip GIF on disk — callers skip the flip when absent. */
function flipGifExists() {
  try { return fs.existsSync(FLIP_GIF_PATH); } catch { return false; }
}

/** Simple 4-point star (sparkle) path — drawn, never a unicode glyph (tofu risk). */
function star4Path(ctx, cx, cy, r) {
  const k = 0.28; // waist fraction — controls how pointy the star is
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + r * k, cy - r * k, cx + r, cy);
  ctx.quadraticCurveTo(cx + r * k, cy + r * k, cx, cy + r);
  ctx.quadraticCurveTo(cx - r * k, cy + r * k, cx - r, cy);
  ctx.quadraticCurveTo(cx - r * k, cy - r * k, cx, cy - r);
  ctx.closePath();
}

/* ════════════════════════════════════════════
 * CANVAS GRID
 * ══════════════════════════════════════════ */
const frames = {};
async function loadFrames() {
  if (frames.Remnant) return;
  await Promise.all(
    Object.entries(FRAME_FILES).map(async ([rarity, file]) => {
      frames[rarity] = await loadImage(path.join(CARDS_DIR, file));
    })
  );
}

/**
 * @param {Array<{name: string, rarity: string, isNew?: boolean}>} results
 * @returns {Promise<Buffer>}
 */
async function renderSummonGrid(results) {
  await loadFrames();

  const layout = LAYOUTS[results.length] ?? LAYOUTS[10];
  const cardW = layout.cardW;
  const cardH = Math.round(cardW * (SRC.h / SRC.w));
  const cols = Math.min(layout.cols, results.length);
  const rows = Math.ceil(results.length / cols);

  // Single pull: keep the full 10-pull (5-column) canvas width and center the
  // card horizontally so the message doesn't change size between pull counts.
  const single = results.length === 1;
  const tenColsW = PAD * 2 + 5 * LAYOUTS[10].cardW + 4 * GAP;
  const canvasW = single ? tenColsW : PAD * 2 + cols * cardW + (cols - 1) * GAP;

  const canvas = createCanvas(canvasW, PAD * 2 + rows * cardH + (rows - 1) * GAP);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < results.length; i++) {
    const god = results[i];
    const dx = single
      ? Math.round((canvasW - cardW) / 2)
      : PAD + (i % cols) * (cardW + GAP);
    const dy = PAD + Math.floor(i / cols) * (cardH + GAP);

    ctx.drawImage(frames[god.rarity], SRC.x, SRC.y, SRC.w, SRC.h, dx, dy, cardW, cardH);

    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    const nameY = dy + cardH * TEXT_Y;
    ctx.font = `bold ${Math.round(cardW * NAME_FONT_SCALE)}px sans-serif`;
    ctx.fillStyle = NAME_COLORS[god.rarity] ?? '#FFFFFF';
    ctx.fillText(god.name, dx + cardW / 2, nameY, cardW * 0.82);

    ctx.font = `${Math.round(cardW * RARITY_FONT_SCALE)}px sans-serif`;
    ctx.fillStyle = '#B9BDCB';
    ctx.fillText(god.rarity, dx + cardW / 2, nameY + cardW * 0.105, cardW * 0.82);

    // NEW / duplicate indicator: small icon + plain shadowed text (same style
    // as the name) inside the inner panel at ~82% of card height.
    //   NEW → drawn 4-point gold star (no unicode glyphs — tofu risk)
    //   dupe → the rarity's essence emoji icon (same CDN cache as bag chests)
    const badgeText = god.isNew
      ? 'NEW'
      : (Number.isFinite(god.essence) ? `+${god.essence} Essence` : 'Essence');
    const badgeColor = god.isNew ? '#F0B232' : '#B9BDCB';
    const badgeCY = dy + cardH * 0.82;
    const iconSize = Math.round(cardW * 0.05); // ~0.05·cardW
    ctx.font = `bold ${Math.round(cardW * 0.06)}px sans-serif`;
    const textW = Math.min(ctx.measureText(badgeText).width, cardW * 0.62);
    const gap = Math.round(cardW * 0.02);

    let icon = null;
    if (!god.isNew) {
      icon = await getEmojiIcon(ALIAS_TO_ESSENCE[god.rarity] ?? 'epic_essence');
    }
    const hasIcon = god.isNew || icon != null;
    const blockW = hasIcon ? iconSize + gap + textW : textW;
    const startX = dx + (cardW - blockW) / 2;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (god.isNew) {
      star4Path(ctx, startX + iconSize / 2, badgeCY, iconSize / 2 + 1);
      ctx.fillStyle = '#F0B232';
      ctx.fill();
    } else if (icon) {
      ctx.drawImage(icon, startX, badgeCY - iconSize / 2, iconSize, iconSize);
    }
    ctx.fillStyle = badgeColor;
    ctx.fillText(badgeText, startX + (hasIcon ? iconSize + gap : 0), badgeCY, cardW * 0.62);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  return canvas.toBuffer('image/png');
}

/* ════════════════════════════════════════════
 * PHASE 1 — flip message (suspense)
 * ══════════════════════════════════════════ */
function buildFlipMessage() {
  const flipGif = new AttachmentBuilder(FLIP_GIF_PATH, { name: 'card_flip.gif' });

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents((td) => td.setContent('## ✨ Invocation in progress...'))
    .addSeparatorComponents((sep) => sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    .addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL('attachment://card_flip.gif'))
    );

  return {
    components: [container],
    files: [flipGif],
    flags: MessageFlags.IsComponentsV2,
  };
}

/* ════════════════════════════════════════════
 * PHASE 2 — result message (full container)
 * Header → separator → grid image → separator →
 * summary → separator → footer
 * ══════════════════════════════════════════ */
/**
 * @param {Array<{name: string, rarity: string, isNew?: boolean}>} results
 * @param {{beliefShards: number, sacredRelics: number}} balances
 */
async function buildResultMessage(results, balances) {
  const buffer = await renderSummonGrid(results);
  const grid = new AttachmentBuilder(buffer, { name: 'summon_result.png' });

  // Rarity counts, ordered rarest-first
  const order = ['Primordial', 'Undying', 'Awakened', 'Remnant'];
  const counts = {};
  for (const r of results) counts[r.rarity] = (counts[r.rarity] ?? 0) + 1;
  const summary = order
    .filter((r) => counts[r])
    .map((r) => `${RARITY_SYMBOLS[r]} ${r} ×**${counts[r]}**`)
    .join(' ・ ');

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    // ── Header ──
    .addTextDisplayComponents((td) =>
      td.setContent(
        `## ✨ Invocation Complete\n*${FLAVOR[results.length] ?? FLAVOR[10]}*`
      )
    )
    .addSeparatorComponents((sep) => sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    // ── Body: the rendered card grid ──
    .addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL('attachment://summon_result.png'))
    )
    .addSeparatorComponents((sep) => sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    // ── Summary ──
    .addTextDisplayComponents((td) => td.setContent(summary))
    .addSeparatorComponents((sep) => sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    // ── Footer (same icons as the bag overview — shared via utils/emojis) ──
    .addTextDisplayComponents((td) =>
      td.setContent(
        `-# ${BELIEF_SHARDS_ICON} Belief Shards: **${balances.beliefShards.toLocaleString()}** ・ ${emoji('sacred_relic')} Sacred Relics: **${balances.sacredRelics.toLocaleString()}**`
      )
    );

  return {
    components: [container],
    files: [grid],
    flags: MessageFlags.IsComponentsV2,
  };
}

module.exports = { renderSummonGrid, buildFlipMessage, buildResultMessage, flipGifExists };
