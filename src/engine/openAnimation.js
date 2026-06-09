'use strict';

/**
 * Edit-based PNG frame-swap animations for chest opens, deity summons, and relic
 * opens (Master §4/§5/§6/§35.7). PURELY COSMETIC — runs AFTER the DB transaction
 * has COMMITTED and the client is released. Never holds a txn across frame delays.
 *
 * Mechanism: send one message (embed + AttachmentBuilder frame 1), then
 * message.edit() swapping the file + image ref per frame, ending on a single edit
 * to the EXISTING results embed (all results appear at once — never one-by-one).
 *
 * Robustness:
 *   - Every frame file is guarded with fs.existsSync — missing frames (incl. the
 *     not-yet-added Supreme shimmer hue variants) are silently skipped.
 *   - The whole run is wrapped in try/catch: on ANY failure we fall straight
 *     through to the results embed (edit the in-flight message, or reply fresh).
 *     The player's pulled items are already committed and can never be lost here.
 *   - Unique per-frame attachment names (the file basename) avoid Discord image
 *     cache staleness across edits; attachments:[] clears the prior frame so they
 *     don't accumulate.
 */

const path = require('path');
const fs = require('fs');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

const ANIM_ROOT = path.join(__dirname, '..', '..', 'assets', 'animations');

const FRAME_MS = 800;    // crack/burst/card/relic frames + final pause — weighty
const SHAKE_MS = 300;    // fast idle↔shake rattle
const SHIMMER_MS = 250;  // rapid Supreme hue swaps
const MAX_FRAMES = 16;   // safety cap (supreme chest = 12, sacred+supreme cards = 10)
const NEUTRAL = 0x2b2d31;

const WEAPON_TIER_COLOR = {
  Common: 0x95a5a6, Rare: 0x3498db, Mythic: 0x9b59b6, Legendary: 0xFFD700, Supreme: 0xe74c3c,
};
const DEITY_TIER_COLOR = {
  Epic: 0x5865F2, Mythic: 0x9b59b6, Legendary: 0xFFD700, Supreme: 0xe74c3c,
};
// Deity tier → card alias, ascending so we can slice "up to highest".
const CARD_ORDER = [
  { tier: 'Epic', alias: 'remnant' },
  { tier: 'Mythic', alias: 'awakened' },
  { tier: 'Legendary', alias: 'undying' },
  { tier: 'Supreme', alias: 'primordial' },
];
const PURPLE = 0x9b59b6; // sacred relic arcane glow

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (file, color, hold) => ({ file, color, hold });
const gacha = (n) => path.join(ANIM_ROOT, 'gacha', `${n}.png`);
const chestFile = (n) => path.join(ANIM_ROOT, 'chests', `${n}.png`);
const relicFile = (n) => path.join(ANIM_ROOT, 'relics', `${n}.png`);

// ── Core runner ────────────────────────────────────────────────────────────
async function runFrameAnimation(message, frames, finalEmbed, frameTitle) {
  let seq = frames.filter((f) => { try { return fs.existsSync(f.file); } catch { return false; } });
  if (seq.length > MAX_FRAMES) seq = seq.slice(0, MAX_FRAMES);

  // No frames available → just post the results (still after commit).
  if (seq.length === 0) {
    return message.reply({ embeds: [finalEmbed], allowedMentions: { repliedUser: false } });
  }

  const mkEmbed = (f) => new EmbedBuilder()
    .setColor(f.color ?? NEUTRAL)
    .setTitle(frameTitle)
    .setImage(`attachment://${path.basename(f.file)}`);
  const mkFile = (f) => new AttachmentBuilder(f.file, { name: path.basename(f.file) });

  let msg = null;
  try {
    msg = await message.reply({
      embeds: [mkEmbed(seq[0])],
      files: [mkFile(seq[0])],
      allowedMentions: { repliedUser: false },
    });
    for (let i = 1; i < seq.length; i++) {
      await delay(seq[i].hold ?? FRAME_MS);
      await msg.edit({ embeds: [mkEmbed(seq[i])], files: [mkFile(seq[i])], attachments: [] });
    }
    // Single reveal: swap to the full results embed at once, clear the image.
    await delay(FRAME_MS);
    await msg.edit({ embeds: [finalEmbed], files: [], attachments: [] });
    return msg;
  } catch (err) {
    // Surface WHICH failure (e.g. Discord code 50013 = Missing Permissions, 429 = rate limit).
    console.error(`[animation] failed → falling through to results: code=${err.code ?? 'n/a'} ${err.message}`);
    try {
      if (msg) await msg.edit({ embeds: [finalEmbed], files: [], attachments: [] });
      else await message.reply({ embeds: [finalEmbed], allowedMentions: { repliedUser: false } });
    } catch {
      await message.reply({ embeds: [finalEmbed], allowedMentions: { repliedUser: false } }).catch(() => {});
    }
    return msg;
  }
}

// ── Frame builders ───────────────────────────────────────────────────────────

// Chest: idle → (shake → idle) ×3 → crack → burst [→ supreme shimmer tail].
function buildChestFrames(chestKey, highestTier) {
  const pop = WEAPON_TIER_COLOR[highestTier] ?? NEUTRAL;
  const frames = [frame(chestFile(`${chestKey}_1_idle`), NEUTRAL, FRAME_MS)];
  for (let c = 0; c < 3; c++) {
    frames.push(frame(chestFile(`${chestKey}_2_shake`), NEUTRAL, SHAKE_MS));
    frames.push(frame(chestFile(`${chestKey}_1_idle`), NEUTRAL, SHAKE_MS));
  }
  frames.push(frame(chestFile(`${chestKey}_3_crack`), pop, FRAME_MS));
  frames.push(frame(chestFile(`${chestKey}_4_burst`), pop, FRAME_MS));
  if (chestKey === 'supreme') {
    for (const h of ['h1', 'h2', 'h3']) {
      frames.push(frame(chestFile(`supreme_4_burst_${h}`), pop, SHIMMER_MS));
    }
  }
  return frames;
}

// Deity card flip (ONE flip, no loop): back → flip_a → flip_b → cards up to highest.
function buildCardFrames(highestTier) {
  const frames = [
    frame(gacha('card_back'), NEUTRAL, FRAME_MS),
    frame(gacha('card_flip_a'), NEUTRAL, FRAME_MS),
    frame(gacha('card_flip_b'), NEUTRAL, FRAME_MS),
  ];
  const topIdx = CARD_ORDER.findIndex((c) => c.tier === highestTier);
  const last = topIdx < 0 ? CARD_ORDER.length - 1 : topIdx;
  for (let i = 0; i <= last; i++) {
    frames.push(frame(gacha(`card_${CARD_ORDER[i].alias}`), DEITY_TIER_COLOR[CARD_ORDER[i].tier], FRAME_MS));
  }
  return frames;
}

// Sacred relic: purple glow → dissolve → the same one-time card flip.
function buildSacredFrames(highestTier) {
  return [
    frame(relicFile('sacred_1'), PURPLE, FRAME_MS),
    frame(relicFile('sacred_2'), PURPLE, FRAME_MS),
    frame(relicFile('sacred_3'), PURPLE, FRAME_MS),
  ].concat(buildCardFrames(highestTier));
}

// Supreme relic: float → crack → portal [→ shimmer] → single Supreme card.
function buildSupremeRelicFrames() {
  const red = DEITY_TIER_COLOR.Supreme;
  const frames = [
    frame(relicFile('supreme_1'), NEUTRAL, FRAME_MS),
    frame(relicFile('supreme_2'), red, FRAME_MS),
    frame(relicFile('supreme_3'), red, FRAME_MS),
  ];
  for (const h of ['h1', 'h2', 'h3']) frames.push(frame(relicFile(`supreme_3_${h}`), red, SHIMMER_MS));
  frames.push(frame(gacha('card_primordial'), red, FRAME_MS));
  return frames;
}

// ── Public API (each guarantees finalEmbed is delivered) ─────────────────────
function playChestAnimation(message, { chestKey, highestTier, finalEmbed, frameTitle }) {
  return runFrameAnimation(message, buildChestFrames(chestKey, highestTier), finalEmbed, frameTitle);
}
function playSummonAnimation(message, { highestTier, finalEmbed, frameTitle }) {
  return runFrameAnimation(message, buildCardFrames(highestTier), finalEmbed, frameTitle);
}
function playRelicAnimation(message, { relicAlias, highestTier, finalEmbed, frameTitle }) {
  const frames = relicAlias === 'supr' ? buildSupremeRelicFrames() : buildSacredFrames(highestTier);
  return runFrameAnimation(message, frames, finalEmbed, frameTitle);
}

module.exports = { playChestAnimation, playSummonAnimation, playRelicAnimation };
