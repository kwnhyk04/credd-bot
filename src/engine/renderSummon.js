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
 *   assets/animations/gacha/card_flip.gif                                (phase-1 suspense)
 */

const {
  ContainerBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { encodeCanvas } = require('../utils/canvasEncode');
const { smallDivider: sep } = require('../utils/componentsV2');
const { emoji, emojiForDisplay } = require('../utils/emojis');
const {
  assetPath,
  assetExistsSync,
  assetExtension,
  loadCachedBuffer,
  isRemoteSource,
  loadAssetImage: loadAssetImageSource,
} = require('../utils/assets');
const { assertDiscordImageAttachmentsAllowed } = require('../utils/egressGuard');
const { tagDiscordAttachmentBuffer } = require('../utils/networkTelemetry');
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
const FLIP_GIF_PATH = assetPath('animations/gacha/card_flip.gif');
// The 1024×1024 rarity frames live with the gacha animation assets (§35.7).

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
  30: 'The heavens fracture. Thirty forgotten souls answer the call of the Last Believer.',
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
  return assetExistsSync(FLIP_GIF_PATH);
}

async function loadAssetImage(source) {
  return loadAssetImageSource(loadImage, source);
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
async function loadFrames() {
  const entries = await Promise.all(
    Object.entries(FRAME_FILES).map(async ([rarity, file]) => [
      rarity,
      await loadAssetImage(assetPath(`animations/gacha/${file}`)),
    ])
  );
  return Object.fromEntries(entries);
}

/**
 * @param {Array<{name: string, rarity: string, isNew?: boolean}>} results
 * @returns {Promise<Buffer>}
 */
async function renderSummonGrid(results) {
  const frames = await loadFrames();

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

  return encodeCanvas(canvas);
}

/* ════════════════════════════════════════════
 * PHASE 1 — flip message (suspense)
 * ══════════════════════════════════════════ */
/**
 * @param {string|null} [flipPath] absolute path to a supporter summon-skin animation
 *   (.webp/.gif). When given, it plays in place of the bundled flip gif (§6); the webp is a
 *   complete pre-rendered animation — sent as-is, no per-pull compositing.
 */
/**
 * Add the summon header to `container` and return any files it needs.
 *  · An equipped summon skin that resolves to an image asset (e.g. a tester's
 *    `testers/<id>/summon.gif`, R2 URL) shows the header line `## ✨ <title>`
 *    followed by the GIF as a MediaGallery — remote URLs cost no bot egress; a
 *    local file is attached. This same block is reused in the result so the gif
 *    is kept after the reveal.
 *  · Otherwise the header is a single line — animated emoji + title together
 *    (`## <emoji> <title>`). flipPath → the skin's flip emoji; else headerEmoji
 *    (relic-open path); else the default card_flip emoji. Never throws.
 * @param {{ flipPath?: string|null, headerEmoji?: string|null, title: string, separateMedia?: boolean }} o
 * @returns {Promise<Array>} files to attach (empty unless a local gif was used)
 */
async function addSummonHeader(container, {
  flipPath = null, headerEmoji = null, title, separateMedia = false, logContext = {},
}) {
  const isImage = typeof flipPath === 'string'
    && ['gif', 'webp', 'png', 'jpg', 'jpeg'].includes(assetExtension(flipPath, ''));
  if (isImage) {
    try {
      container.addTextDisplayComponents((td) => td.setContent('## ✨ ' + title));
      if (separateMedia) container.addSeparatorComponents(sep);
      if (isRemoteSource(flipPath)) {
        container.addMediaGalleryComponents((g) => g.addItems((item) => item.setURL(flipPath)));
        return [];
      }
      const name = `summonflip.${assetExtension(flipPath, 'gif')}`;
      const buffer = await loadCachedBuffer(flipPath);
      assertDiscordImageAttachmentsAllowed('summon animation attachment fallback', {
        ...logContext,
        imageType: 'summon_animation',
        bytes: buffer.length,
      });
      tagDiscordAttachmentBuffer(buffer, {
        ...logContext,
        system: 'summon',
        command: logContext.command || 'summon',
        imageType: 'summon_animation',
      });
      const file = new AttachmentBuilder(buffer, { name });
      container.addMediaGalleryComponents((g) => g.addItems((item) => item.setURL(`attachment://${name}`)));
      return [file];
    } catch (err) {
      // Missing/unreadable skin gif → fall through to the default emoji header.
      console.error('[renderSummon] summon-skin gif render failed, using default:', err.message);
    }
  }
  const e = flipPath ? summonFlipEmoji(flipPath) : (headerEmoji || summonFlipEmoji(null));
  container.addTextDisplayComponents((td) => td.setContent('## ' + e + ' ' + title));
  return [];
}

async function buildFlipMessage(flipPath = null, logContext = {}) {
  // Summon suspense EMBED (CV2): one header line — emoji + title together (or the
  // skin gif directly under the header). MUST be Components-V2 (not legacy
  // `content`): the result phase edits this into a CV2 container and Discord
  // rejects a legacy→CV2 conversion.
  const container = new ContainerBuilder().setAccentColor(ACCENT);
  const files = await addSummonHeader(container, {
    flipPath,
    title: 'Invocation in progress...',
    separateMedia: true,
    logContext,
  });
  return {
    components: [container],
    files,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/* ════════════════════════════════════════════
 * PHASE 2 — result message (full container)
 * Header → separator → grid image → separator →
 * summary → separator → footer
 * ══════════════════════════════════════════ */
/**
 * @param {Array<{name: string, rarity: string, isNew?: boolean}>} results
 * @param {{beliefShards: number, sacredRelics: number, supremeRelics?: number}} balances
 *        supremeRelics is optional — only the relic-open paths show it.
 */
async function buildResultMessage(results, balances, opts = {}) {
  const order = ['Primordial', 'Undying', 'Awakened', 'Remnant'];
  const counts = {};
  for (const r of results) counts[r.rarity] = (counts[r.rarity] ?? 0) + 1;
  const summary = order
    .filter((r) => counts[r])
    .map((r) => `${RARITY_SYMBOLS[r]} ${r} x**${counts[r]}**`)
    .join(' - ');

  // Keep the animation header (play-once emoji, or the tester gif) and update the
  // title to the finished text, then add the result body below (§ reveal).
  const container = new ContainerBuilder().setAccentColor(ACCENT);
  const files = await addSummonHeader(container, {
    flipPath: opts.flipPath,
    headerEmoji: opts.headerEmoji,
    title: `Invocation Complete\n*${FLAVOR[results.length] ?? FLAVOR[10]}*`,
    logContext: opts.logContext || {},
  });
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(groupSummonResults(results)))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(summary))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(
        `-# ${emoji('belief_shards')} Belief Shards: **${balances.beliefShards.toLocaleString()}** - ${emoji('sacred_relic')} Sacred Relics: **${balances.sacredRelics.toLocaleString()}**` +
        (balances.supremeRelics != null
          ? ` - ${emoji('supreme_relic')} Supreme Relics: **${balances.supremeRelics.toLocaleString()}**`
          : '')
      )
    );

  return {
    components: [container],
    files,
    flags: MessageFlags.IsComponentsV2,
  };
}

function summonFlipEmoji(flipPath = null) {
  const raw = String(flipPath || '').replace(/\\/g, '/').toLowerCase();
  const base = raw.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
  const known = [
    'e_stardust_constellation_s4',
    'e_eternal_supernova_s3',
    'e_aurora_ribbon_s2',
    'c_rune_glow_s1',
    'stardust_constellation',
    'eternal_supernova',
    'aurora_ribbon',
    'rune_glow',
  ];
  const key = known.find((name) => base === name || raw.includes(`/${name}.`)) || 'card_flip';
  const icon = emoji(key);
  return icon === emoji('__missing__') ? emoji('card_flip') : icon;
}

function groupSummonResults(results) {
  const groups = new Map();
  for (const r of results) {
    const key = `${r.name}|${r.rarity}`;
    const entry = groups.get(key) || { name: r.name, rarity: r.rarity, newCount: 0, essence: 0, pulls: 0 };
    entry.pulls += 1;
    if (r.isNew) entry.newCount += 1;
    else entry.essence += Number(r.essence) || 0;
    groups.set(key, entry);
  }
  return [...groups.values()].map((g) => {
    const status = [
      g.newCount ? `New${g.newCount > 1 ? ` x${g.newCount}` : ''}` : null,
      g.essence ? `Essence +${g.essence.toLocaleString()}` : null,
    ].filter(Boolean).join(' + ') || 'Owned';
    const count = g.pulls > 1 ? ` x${g.pulls}` : '';
    return `${emojiForDisplay(g.name, 'Deity')} **${g.name}**${count} - ${g.rarity} - ${status}`;
  }).join('\n');
}

/* ════════════════════════════════════════════
 * SINGLE CARD COMPOSITE — deity info view
 * Frame inner panel is OPAQUE, so the portrait is drawn INTO the inner
 * window on top of the frame (clipped), not under it. No name text when a
 * portrait is present (the message header carries it); missing portrait →
 * frame + name/rarity text exactly like the gacha cards.
 * ══════════════════════════════════════════ */

// Inner-window rect as fractions of the CROPPED card (tuned to the frame art).
const INNER = { x: 0.155, y: 0.135, w: 0.69, h: 0.74 };

// Full 10-pull grid width — info renders center their card/art on this canvas
// so the message width matches the summon results.
const WIDE_W = PAD * 2 + 5 * LAYOUTS[10].cardW + 4 * GAP;

/**
 * @param {{name: string, rarity: string, portraitPath: string|null}} opts
 * @returns {Promise<Buffer>} PNG — one 340px card centered on the wide canvas
 */
async function renderDeityCard({ name, rarity, portraitPath }) {
  const frames = await loadFrames();
  const cardW = LAYOUTS[1].cardW; // 340
  const cardH = Math.round(cardW * (SRC.h / SRC.w));

  const canvas = createCanvas(WIDE_W, PAD * 2 + cardH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Card horizontally centered (same approach as the centered single pull).
  const ox = Math.round((WIDE_W - cardW) / 2);
  const oy = PAD;
  ctx.translate(ox, oy);
  ctx.drawImage(frames[rarity] ?? frames.Remnant, SRC.x, SRC.y, SRC.w, SRC.h, 0, 0, cardW, cardH);

  let portrait = null;
  if (portraitPath) {
    try {
      portrait = await loadAssetImage(portraitPath);
    } catch (err) {
      console.error(`[renderSummon] portrait load failed (${portraitPath}):`, err.message);
    }
  }

  if (portrait) {
    const win = {
      x: Math.round(cardW * INNER.x),
      y: Math.round(cardH * INNER.y),
      w: Math.round(cardW * INNER.w),
      h: Math.round(cardH * INNER.h),
    };
    // Cover-fit the portrait into the window, clipped so it never bleeds onto the frame.
    const scale = Math.max(win.w / portrait.width, win.h / portrait.height);
    const dw = portrait.width * scale;
    const dh = portrait.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(win.x, win.y, win.w, win.h);
    ctx.clip();
    ctx.drawImage(portrait, win.x + (win.w - dw) / 2, win.y + (win.h - dh) / 2, dw, dh);
    ctx.restore();
  } else {
    // Fallback: name + rarity text like the gacha cards.
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    const nameY = cardH * TEXT_Y;
    ctx.font = `bold ${Math.round(cardW * NAME_FONT_SCALE)}px sans-serif`;
    ctx.fillStyle = NAME_COLORS[rarity] ?? '#FFFFFF';
    ctx.fillText(name, cardW / 2, nameY, cardW * 0.82);
    ctx.font = `${Math.round(cardW * RARITY_FONT_SCALE)}px sans-serif`;
    ctx.fillStyle = '#B9BDCB';
    ctx.fillText(rarity, cardW / 2, nameY + cardW * 0.105, cardW * 0.82);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  return encodeCanvas(canvas);
}

/**
 * Center a standalone artwork file (weapon info) on the wide canvas with the
 * grid background — height capped to the single-card height, aspect preserved.
 * @returns {Promise<Buffer|null>} PNG, or null when the file can't be loaded
 */
async function renderCenteredArt(filePath) {
  const candidates = Array.isArray(filePath) ? filePath : [filePath];
  let img;
  let lastErr = null;
  for (const candidate of candidates.filter(Boolean)) {
    try {
      img = await loadAssetImage(candidate);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!img) {
    if (lastErr) {
      console.error(`[renderSummon] art load failed (${candidates.filter(Boolean).join(', ')}):`, lastErr.message);
    }
    return null;
  }
  const cardH = Math.round(LAYOUTS[1].cardW * (SRC.h / SRC.w));
  const maxW = WIDE_W - PAD * 2;
  const scale = Math.min(cardH / img.height, maxW / img.width);
  const dw = Math.round(img.width * scale);
  const dh = Math.round(img.height * scale);

  const canvas = createCanvas(WIDE_W, PAD * 2 + dh);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, Math.round((WIDE_W - dw) / 2), PAD, dw, dh);
  return encodeCanvas(canvas);
}

module.exports = {
  renderSummonGrid,
  renderDeityCard,
  renderCenteredArt,
  buildFlipMessage,
  buildResultMessage,
  flipGifExists,
  summonFlipEmoji,
  RARITY_SYMBOLS,
};
