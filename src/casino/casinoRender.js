'use strict';

/**
 * casinoRender.js — Components V2 builders for all six games.
 *
 * SPIN frames use the animated GIFs (padded to a fixed canvas via imagePad). RESULT frames are
 * composited on canvas (casinoCanvas) so the art is small + centered and the win/lose banner is
 * CENTERED (Discord text can't center, so the banner is drawn). Cards render as one small centered
 * card-strip per hand (no media-gallery mosaic). Crash's body is a drawn panel.
 */

const {
  ContainerBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, MessageFlags,
} = require('discord.js');
const imagePad = require('./imagePad');
const canvas = require('./casinoCanvas');
const { smallDivider: sep } = require('../utils/componentsV2');
const { assetPath, getAssetUrl, remoteAssetAvailable } = require('../utils/assets');
const { getCachedCanvasUrl } = require('../utils/canvasCache');
const { COLORS } = canvas;
const { SLOT_FACE_INDEX } = require('./payoutTables');
const { BACK_FILE, blackjackValue } = require('./cardDeck');

const ACCENT = {
  coin: 0xc9ccd1, dice: 0xc77b3b, baccarat: 0x9b59b6,
  blackjack: 0xe0a526, slot: 0xe67e22, crash: 0xe74c3c,
  win: 0x43d675, loss: 0xf23f43, push: 0x95a5a6,
};
// Padded-canvas sizes for the SPIN GIFs (smaller per feedback).
const DIM = { coin: { W: 460, H: 132, contentH: 92 }, dice: { W: 200, H: 120, contentH: 84 } };
const CASINO_CANVAS_RENDER_REV = 1;

const fmt = (n) => Number(n).toLocaleString();
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

const coinGif = (r) => assetPath(`casino/coin/flip_${r}.gif`);
const coinPng = (r) => assetPath(`casino/coin/${r}.png`);
const diceGif = (n) => assetPath(`casino/dice/dice_roll_${n}.gif`);
const dicePng = (n) => assetPath(`casino/dice/face_${n}.png`);
const cardBack = assetPath(`casino/cards/img/${BACK_FILE}`); // [fix] back lives in img/ alongside faces
const slotReelGif = (i, face) => assetPath(`casino/slots/${['3s', '4s', '5s'][i]}/${['3s', '4s', '5s'][i]}_${face}_${SLOT_FACE_INDEX[face]}.gif`);
const slotFacePng = (face) => assetPath(`casino/slots/${face}_face.png`);

function head(c, title, subtitle) {
  c.addTextDisplayComponents((td) => td.setContent(title));
  if (subtitle) c.addTextDisplayComponents((td) => td.setContent(subtitle));
}
function balanceLine(c, balance) {
  c.addSeparatorComponents(sep).addTextDisplayComponents((td) => td.setContent(`-# **Balance:** ${fmt(balance)} Credux`));
}
function galleryUrl(c, url) {
  c.addMediaGalleryComponents((g) => g.addItems((i) => i.setURL(url)));
}
function galleryOne(c, name) {
  galleryUrl(c, `attachment://${name}`);
}
function att(buf, name) { return new AttachmentBuilder(buf, { name }); }

async function galleryFromCanvasCache(c, files, parts, build, name) {
  const cached = await getCachedCanvasUrl(
    ['casino-canvas', CASINO_CANVAS_RENDER_REV, parts],
    build
  );
  if (cached) {
    galleryUrl(c, cached.url);
    return;
  }
  files.push(att(await build(), name));
  galleryOne(c, name);
}

/**
 * Egress guard: deterministic media (spin GIFs, result face strips) is
 * pre-rendered by scripts/build-casino-spin-assets.js and uploaded to R2, so
 * the message can reference the public URL — the bot uploads ZERO bytes to
 * Discord for it. Attach-fallback (byte-identical render) covers a missing/
 * not-yet-uploaded object, so behavior never changes for users.
 * `rels` = one gallery row; all-or-nothing so a row never mixes URL + attach.
 */
async function galleryFromCdn(c, files, rels, fallbacks) {
  const relList = Array.isArray(rels) ? rels : [rels];
  const available = await Promise.all(relList.map((rel) => remoteAssetAvailable(rel)));
  if (available.every(Boolean)) {
    c.addMediaGalleryComponents((g) => {
      for (const rel of relList) g.addItems((i) => i.setURL(getAssetUrl(rel)));
      return g;
    });
    return;
  }
  for (const fb of (Array.isArray(fallbacks) ? fallbacks : [fallbacks])) {
    files.push(att(await fb.build(), fb.name));
  }
  c.addMediaGalleryComponents((g) => {
    for (const fb of (Array.isArray(fallbacks) ? fallbacks : [fallbacks])) {
      g.addItems((i) => i.setURL(`attachment://${fb.name}`));
    }
    return g;
  });
}

/** Plain (no-emoji) banner line for the centered canvas text. */
function bannerLine(kind, game, { net, bet, extra } = {}) {
  const flavor = {
    coin_toss:    { win: 'Fate smiles upon you',           loss: 'Fate was not with you' },
    dice_roll:    { win: 'The ancients favor you',          loss: 'The ancients were against you' },
    baccarat:     { win: 'The Oracle spoke in your favor',  loss: 'The Oracle spoke against you' },
    blackjack:    { win: 'The Sacred XXI favors you',       loss: 'The Sacred XXI turns away' },
    slot_machine: { win: 'The relics align',                loss: 'The relics do not align' },
    crash:        { win: 'You cashed out in time',          loss: 'The ascension collapsed' },
  }[game];
  if (kind === 'push') return `Push — your ${fmt(bet)} Credux is returned`;
  if (kind === 'win') return `${extra || flavor.win} — +${fmt(net)} Credux`;
  return `${extra || flavor.loss} — ${fmt(bet)} Credux lost`;
}
const bannerColor = (kind) => (kind === 'win' ? COLORS.green : kind === 'push' ? COLORS.grey : COLORS.red);
// Pass card objects straight through — casinoCanvas.cardStrip composites each face (CardRender).
const cardEntries = (hand) => hand;

/* ───────────────────────── COIN TOSS ───────────────────────── */
async function buildCoin({ phase, uid, bet, pick, outcome, balance }) {
  const result = phase === 'result';
  const c = new ContainerBuilder().setAccentColor(result ? (outcome.win ? ACCENT.win : ACCENT.loss) : ACCENT.coin);
  head(c, '## 🪙 Coin of Fates', `-# <@${uid}> bet **${fmt(bet)}** Credux on **${cap(pick)}**`);
  c.addSeparatorComponents(sep);
  const files = [];
  if (result) {
    const kind = outcome.win ? 'win' : 'loss';
    await galleryFromCdn(c, files, `generated/casino/coin_face_${outcome.result}.png`, {
      name: 'coin_img.png',
      build: () => canvas.strip([coinPng(outcome.result)], { tile: 78 }),
    });
    files.push(att(await canvas.resultStrip([
      { text: `${outcome.faceName} — ${cap(outcome.result)}`, size: 11, bold: true },
      { text: bannerLine(kind, 'coin_toss', { net: outcome.payout - bet, bet }), size: 10, bold: true, color: bannerColor(kind) },
    ]), 'coin_res.png'));
    c.addSeparatorComponents(sep); galleryOne(c, 'coin_res.png');
  } else {
    await galleryFromCdn(c, files, `generated/casino/coin_spin_${outcome.result}.gif`, {
      name: 'coin_spin.gif',
      build: () => imagePad.padGif(coinGif(outcome.result), DIM.coin),
    });
    c.addTextDisplayComponents((td) => td.setContent('-# *The coin spins through the air…*'));
  }
  balanceLine(c, balance);
  return { components: [c], files, flags: MessageFlags.IsComponentsV2 };
}

/* ───────────────────────── DICE ROLL ───────────────────────── */
async function buildDice({ phase, uid, bet, pick, outcome, balance }) {
  const result = phase === 'result';
  const c = new ContainerBuilder().setAccentColor(result ? (outcome.win ? ACCENT.win : ACCENT.loss) : ACCENT.dice);
  head(c, '## 🎲 Trial of the Ancients', `-# <@${uid}> bet **${fmt(bet)}** Credux on **${cap(pick)}**`);
  c.addSeparatorComponents(sep);
  const files = [];
  if (result) {
    const kind = outcome.win ? 'win' : 'loss';
    await galleryFromCdn(c, files, `generated/casino/dice_faces_${outcome.d1}_${outcome.d2}.png`, {
      name: 'dice_img.png',
      build: () => canvas.strip([dicePng(outcome.d1), dicePng(outcome.d2)], { tile: 72 }),
    });
    files.push(att(await canvas.resultStrip([
      { text: `Total: ${outcome.sum} — ${cap(outcome.parity)}`, size: 11, bold: true },
      { text: bannerLine(kind, 'dice_roll', { net: outcome.payout - bet, bet }), size: 10, bold: true, color: bannerColor(kind) },
    ]), 'dice_res.png'));
    c.addSeparatorComponents(sep); galleryOne(c, 'dice_res.png');
  } else {
    await galleryFromCdn(c, files,
      [`generated/casino/die_${outcome.d1}.gif`, `generated/casino/die_${outcome.d2}.gif`],
      [
        { name: 'die1.gif', build: () => imagePad.padGif(diceGif(outcome.d1), DIM.dice) },
        { name: 'die2.gif', build: () => imagePad.padGif(diceGif(outcome.d2), DIM.dice) },
      ]);
    c.addTextDisplayComponents((td) => td.setContent('-# *The ancient dice tumble…*'));
  }
  balanceLine(c, balance);
  return { components: [c], files, flags: MessageFlags.IsComponentsV2 };
}

/* ───────────────────────── BACCARAT (staged) ───────────────────────── */
/**
 * @param player/banker  the cards dealt SO FAR at this stage (full hands when result).
 * @param pReveal/bReveal how many of each hand are face-up; positions beyond render as card_back
 *                        (the sequential backs-first reveal). Ignored when `result` (all face-up).
 * @param result         when true, show scores + verdict + banner.
 */
async function buildBaccarat({ uid, bet, pick, player, banker, outcome, result, note, balance, pReveal, bReveal }) {
  const kind = !result ? null : outcome.push ? 'push' : outcome.win ? 'win' : 'loss';
  const c = new ContainerBuilder().setAccentColor(
    !result ? ACCENT.baccarat : kind === 'push' ? ACCENT.push : kind === 'win' ? ACCENT.win : ACCENT.loss
  );
  head(c, '## 🃏 The Oracle\'s Table', `-# <@${uid}> bet **${fmt(bet)}** Credux on **${cap(pick)}**`);
  c.addSeparatorComponents(sep);

  // Face-up for the first `shown` cards (card object → composited face), face-down
  // card_back path for the rest (staged reveal).
  const faceOrBack = (hand, shown) => hand.map((card, i) => (i < shown ? card : cardBack));
  const pShown = result ? player.length : (pReveal || 0);
  const bShown = result ? banker.length : (bReveal || 0);
  const playerCards = faceOrBack(player, pShown);
  const bankerCards = faceOrBack(banker, bShown);

  const files = [];
  c.addTextDisplayComponents((td) => td.setContent(result ? `**PLAYER** — Score ${outcome.pScore}` : '**PLAYER**'));
  await galleryFromCanvasCache(c, files, ['baccarat-player', playerCards], () => canvas.cardStrip(playerCards), 'bac_p.png');
  c.addSeparatorComponents(sep);
  c.addTextDisplayComponents((td) => td.setContent(result ? `**BANKER** — Score ${outcome.bScore}` : '**BANKER**'));
  await galleryFromCanvasCache(c, files, ['baccarat-banker', bankerCards], () => canvas.cardStrip(bankerCards), 'bac_b.png');

  if (result) {
    const verdict = outcome.push ? 'Tie' : `${cap(outcome.winner)} wins`;
    files.push(att(await canvas.resultStrip([
      { text: `${outcome.pScore} vs ${outcome.bScore} — ${verdict}`, size: 11, bold: true },
      { text: bannerLine(kind, 'baccarat', { net: outcome.payout - bet, bet }), size: 10, bold: true, color: bannerColor(kind) },
    ]), 'bac_res.png'));
    c.addSeparatorComponents(sep); galleryOne(c, 'bac_res.png');
  } else {
    c.addSeparatorComponents(sep).addTextDisplayComponents((td) => td.setContent(`-# *${note || 'The Oracle deals…'}*`));
  }
  balanceLine(c, balance);
  return { components: [c], files, flags: MessageFlags.IsComponentsV2 };
}

/* ───────────────────────── BLACKJACK ───────────────────────── */
function blackjackButtons(uid) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bj:hit:${uid}`).setLabel('Hit').setEmoji('🃏').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`bj:stand:${uid}`).setLabel('Stand').setEmoji('✋').setStyle(ButtonStyle.Secondary),
  );
}

/** mode: 'active' (hole hidden + buttons) | 'final' (revealed + banner). */
async function buildBlackjack({ mode, uid, bet, session, balance }) {
  const final = mode === 'final';
  const accent = !final ? ACCENT.blackjack
    : session.outcome === 'win' ? ACCENT.win : session.outcome === 'push' ? ACCENT.push : ACCENT.loss;
  const c = new ContainerBuilder().setAccentColor(accent);
  head(c, '## 🗡️ The Sacred XXI', `-# <@${uid}> bet **${fmt(bet)}** Credux`);
  c.addSeparatorComponents(sep);

  const dealerCards = session.revealed
    ? cardEntries(session.dealer)
    : [session.dealer[0], cardBack];
  const dealerScore = session.revealed ? String(blackjackValue(session.dealer)) : `${blackjackValue([session.dealer[0]])} + ?`;
  const files = [];
  c.addTextDisplayComponents((td) => td.setContent(`**DEALER** — Score ${dealerScore}`));
  await galleryFromCanvasCache(c, files, ['blackjack-dealer', dealerCards], () => canvas.cardStrip(dealerCards), 'bj_d.png');
  c.addSeparatorComponents(sep);
  c.addTextDisplayComponents((td) => td.setContent(`**YOU** — Score ${blackjackValue(session.player)}`));
  const playerCards = cardEntries(session.player);
  await galleryFromCanvasCache(c, files, ['blackjack-player', playerCards], () => canvas.cardStrip(playerCards), 'bj_y.png');

  const components = [c];
  if (final) {
    const kind = session.outcome === 'push' ? 'push' : session.outcome === 'win' ? 'win' : 'loss';
    const bust = blackjackValue(session.player) > 21;
    const resultLines = [
      { text: bannerLine(kind, 'blackjack', { net: session.payout - bet, bet, extra: bust ? 'Bust' : undefined }), size: 10, bold: true, color: bannerColor(kind) },
    ];
    c.addSeparatorComponents(sep);
    await galleryFromCanvasCache(c, files, ['blackjack-result', resultLines], () => canvas.resultStrip(resultLines), 'bj_res.png');
  } else {
    c.addSeparatorComponents(sep).addTextDisplayComponents((td) => td.setContent('-# Your move — Hit or Stand?'));
    components.push(blackjackButtons(uid));
  }
  balanceLine(c, balance);
  return { components, files, flags: MessageFlags.IsComponentsV2 };
}

/* ───────────────────────── SLOT MACHINE ───────────────────────── */
const SLOT_LEGEND = '-# Horus ×1.5 · Lightning ×2 · Skull ×5 · Trident ×10 · Wings ×20';

async function buildSlot({ phase, uid, bet, outcome, balance }) {
  const result = phase === 'result';
  const c = new ContainerBuilder().setAccentColor(result ? (outcome.win ? ACCENT.win : ACCENT.loss) : ACCENT.slot);
  head(c, '## 🎰 The Vault of Relics', `-# <@${uid}> spins the sacred reels for **${fmt(bet)}** Credux`);
  c.addSeparatorComponents(sep);
  const files = [];
  if (result) {
    const kind = outcome.win ? 'win' : 'loss';
    await galleryFromCdn(c, files, `generated/casino/slot_faces_${outcome.reels.join('_')}.png`, {
      name: 'slot_img.png',
      build: () => canvas.strip(outcome.reels.map(slotFacePng), { tile: 84 }),
    });
    c.addTextDisplayComponents((td) => td.setContent(SLOT_LEGEND));
    files.push(att(await canvas.resultStrip([
      { text: outcome.reels.map(cap).join(' — '), size: 9, color: COLORS.dim },
      { text: bannerLine(kind, 'slot_machine', { net: outcome.payout - bet, bet, extra: outcome.win ? `The relics align ×${outcome.mult}` : undefined }), size: 10, bold: true, color: bannerColor(kind) },
    ]), 'slot_res.png'));
    c.addSeparatorComponents(sep); galleryOne(c, 'slot_res.png');
  } else {
    // One-line composited reel strip (reels keep their 3s/4s/5s stagger; holds last frame on end).
    await galleryFromCdn(c, files, `generated/casino/slot_spin_${outcome.reels.join('_')}.gif`, {
      name: 'slot_spin.gif',
      build: () => imagePad.reelStripGif([slotReelGif(0, outcome.reels[0]), slotReelGif(1, outcome.reels[1]), slotReelGif(2, outcome.reels[2])]),
    });
    c.addTextDisplayComponents((td) => td.setContent(SLOT_LEGEND))
     .addTextDisplayComponents((td) => td.setContent('-# *The sacred reels spin…*'));
  }
  balanceLine(c, balance);
  return { components: [c], files, flags: MessageFlags.IsComponentsV2 };
}

/* ───────────────────────── CRASH ───────────────────────── */
function crashButtons(uid, canCashOut) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`crash:push:${uid}`).setLabel('Push').setEmoji('⬆️').setStyle(ButtonStyle.Primary),
  );
  if (canCashOut) row.addComponents(new ButtonBuilder().setCustomId(`crash:cashout:${uid}`).setLabel('Cash Out').setEmoji('💰').setStyle(ButtonStyle.Success));
  return row;
}

async function buildCrash({ uid, bet, session, balance }) {
  const crashed = session.state === 'crashed';
  const cashed = session.state === 'cashed';
  const active = session.state === 'active';
  const c = new ContainerBuilder().setAccentColor(crashed ? ACCENT.loss : cashed ? ACCENT.win : ACCENT.crash);
  head(c, '## ⚡ The Ascension', `-# <@${uid}> bet **${fmt(bet)}** Credux — push your luck or walk away`);
  c.addSeparatorComponents(sep);

  const name = `crash_${session.state}_${session.push}.png`;
  const files = [];
  const panelInput = { multiplier: session.multiplier, crashed, crashPoint: session.crashPoint, bet, pushes: session.push };
  await galleryFromCanvasCache(c, files, ['crash-panel', panelInput], () => canvas.crashPanel(panelInput), name);

  const components = [c];
  if (active) {
    c.addSeparatorComponents(sep).addTextDisplayComponents((td) => td.setContent(
      session.push === 0 ? '-# Press **Push** to begin the ascension.' : '-# **Push** for more, or **Cash Out** to bank it.'));
    components.push(crashButtons(uid, session.push >= 1));
  } else {
    const kind = crashed ? 'loss' : 'win';
    const extra = cashed ? `You ascended to ${session.multiplier}×` : `The ascension collapsed at ${session.crashPoint}×`;
    const resultLines = [
      { text: bannerLine(kind, 'crash', { net: session.payout - bet, bet, extra }), size: 10, bold: true, color: bannerColor(kind) },
    ];
    c.addSeparatorComponents(sep);
    await galleryFromCanvasCache(c, files, ['crash-result', resultLines], () => canvas.resultStrip(resultLines), 'crash_res.png');
  }
  balanceLine(c, balance);
  return { components, files, flags: MessageFlags.IsComponentsV2 };
}

/**
 * Result-swap waits (ms). [v4.7] coin reveal pulled −0.5s so it lands on the intended 4.5s mark
 * (was effectively ~5.0s); slot reveal lands just after the third reel stops. Dice unchanged
 * (roll 0–2s, reveal 2.5s).
 */
const WAIT = { coin: 4000, dice: 2500, slot: 6000 };

/** Warm fixed (non-card) padded assets so the first spin isn't slow. */
function prewarm() {
  const jobs = [];
  for (const r of ['heads', 'tails']) jobs.push({ path: coinGif(r), dim: DIM.coin, animated: true });
  for (let n = 1; n <= 6; n++) jobs.push({ path: diceGif(n), dim: DIM.dice, animated: true });
  imagePad.prewarm(jobs);
}

module.exports = {
  buildCoin, buildDice, buildBaccarat, buildBlackjack, buildSlot, buildCrash,
  WAIT, prewarm, ACCENT,
};
