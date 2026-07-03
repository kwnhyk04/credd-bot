'use strict';

/**
 * chestOpen.js — gif-animated open flow for chests AND relics (Components V2).
 *
 * Flow (backend has ALREADY rolled + committed before this is called):
 *   1. reply: container [header → separator → chest GIF media gallery]
 *   2. Promise.all([build result payload, play-once delay])
 *   3. EDIT the same message into the result container (attachments: [] drops
 *      the old gif — required or discord.js keeps it attached)
 *
 * The result payload is caller-supplied (weapon grid via buildWeaponResultPayload,
 * or renderSummon's deity container for relics) so both paths share one runner.
 */

const {
  ContainerBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const { renderWeaponResults, TIERS } = require('./weaponResultRenderer');
const { smallDivider: sep } = require('../utils/componentsV2');
const { emoji } = require('../utils/emojis');
const { makeOptimizedAttachment } = require('../utils/imageOutput');
const { capitalizeLower } = require('../utils/textFormat');
const {
  assetPath,
  assetExistsSync,
  assetFileName,
  attachmentSource,
  isRemoteSource,
} = require('../utils/assets');

const ANIMATION_MS = 3000; // matches the ~2.5s GIFs + buffer

// gifKey (users_bag column / relic kind) → gif filename in assets/animations/chests
const CHEST_GIFS = {
  silver_chest: 'silver_chest.gif',
  gold_chest: 'gold_chest.gif',
  boss_treasure_chest: 'boss_treasure_chest.gif',
  boss_golden_chest: 'boss_golden_chest.gif',
  supreme_chest: 'supreme_chest.gif',
  sacred_relic: 'sacred_relic.gif',
  supreme_relic: 'supreme_relic.gif',
  // [v5 Phase 2] rune bags (gif file optional — missing → results-only flow).
  lesser_bag: 'lesser_bag.gif',
  greater_bag: 'greater_bag.gif',
  divine_bag: 'divine_bag.gif',
};

const CHEST_FLAVOR = {
  silver_chest: 'The silver lock gives way. Steel and fortune spill forth.',
  gold_chest: 'The gold yielded its secrets. These weapons are now yours to wield.',
  boss_treasure_chest: 'The boss’s hoard cracks open. Power answers the victor.',
  boss_golden_chest: 'Gilded and cursed — the golden hoard surrenders its arms.',
  supreme_chest: 'Light pours from the supreme vault. Few have seen what lies within.',
  sacred_relic: 'The sacred relic burns away, leaving its blessing behind.',
  supreme_relic: 'The supreme relic shatters — raw light forged into steel.',
  lesser_bag: 'The lesser bag unravels — faint runes scatter into your hand.',
  greater_bag: 'The greater bag splits open, humming with bound power.',
  divine_bag: 'The divine bag erupts in light — the strongest runes answer.',
};

// Weapon tiers rarest-first for the summary line.
const TIER_ORDER = ['supreme', 'legendary', 'mythic', 'rare', 'common'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** e.g. `★ **Legendary** ×1 ・ ❖ **Mythic** ×4` (rarest first). */
function tierSummary(items) {
  const counts = {};
  for (const it of items) {
    const k = (it.tier || 'common').toLowerCase();
    counts[k] = (counts[k] || 0) + 1;
  }
  return TIER_ORDER
    .filter((t) => counts[t])
    .map((t) => `${TIERS[t]?.icon || '•'} **${capitalizeLower(t)}** ×${counts[t]}`)
    .join(' ・ ');
}

/** Resolve the gif's on-disk path + attachment name. gifPath (absolute) overrides
 *  the bundled CHEST_GIFS lookup so rune bags can load from assets/items/runes. */
function resolveGif(gifKey, gifPath) {
  if (gifPath) return { name: assetFileName(gifPath, 'open.gif'), src: gifPath };
  const name = CHEST_GIFS[gifKey];
  return name ? { name, src: assetPath(`animations/chests/${name}`) } : null;
}

/** Animation-phase container: header → separator → the chest gif. */
async function animationPayload(gifKey, animTitle, gifPath) {
  const g = resolveGif(gifKey, gifPath);
  const remote = isRemoteSource(g.src);
  const mediaUrl = remote ? g.src : `attachment://${g.name}`;
  const container = new ContainerBuilder()
    .setAccentColor(0xf0b232)
    .addTextDisplayComponents((td) =>
      td.setContent(`## ✨ ${animTitle}\n*${CHEST_FLAVOR[gifKey] ?? 'The chest creaks open...'}*`)
    )
    .addSeparatorComponents(sep)
    .addMediaGalleryComponents((gal) =>
      gal.addItems((item) => item.setURL(mediaUrl))
    );
  return {
    components: [container],
    files: remote ? [] : [new AttachmentBuilder(await attachmentSource(g.src), { name: g.name })],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { repliedUser: false },
  };
}

/**
 * Weapon-chest result container (prompt layout): header → italic flavor →
 * separator → weapon grid image → tier summary → separator → relic counts.
 * @param {object} p
 * @param {string} p.gifKey         chest column (flavor lookup)
 * @param {string} p.title          e.g. 'Opened 5 × Gold Chest'
 * @param {Array}  p.items          [{ id, name, tier, stats }, …] renderer shape
 * @param {number} p.sacredRelics   balance AFTER the open
 * @param {number} p.supremeRelics  balance AFTER the open
 * @param {number} p.remaining      chests of this type left
 * @param {string} p.chestLabel     display label, e.g. 'Gold Chest'
 * @param {string} p.chestEmojiName registry emoji name for the chest
 */
async function buildWeaponResultPayload(p) {
  const grid = await makeOptimizedAttachment(await renderWeaponResults(p.items), 'chest_results');

  const container = new ContainerBuilder()
    .setAccentColor(0xf0b232)
    .addTextDisplayComponents((td) =>
      td.setContent(`## ✨ ${p.title}\n*${CHEST_FLAVOR[p.gifKey] ?? 'The chest creaks open...'}*`)
    )
    .addSeparatorComponents(sep)
    .addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL(grid.url))
    )
    .addTextDisplayComponents((td) => td.setContent(tierSummary(p.items)))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(
        `-# ${emoji('sacred_relic')} Sacred Relics: **${p.sacredRelics.toLocaleString()}** ・ ` +
        `${emoji('supreme_relic')} Supreme Relics: **${p.supremeRelics.toLocaleString()}**\n` +
        `-# ${emoji(p.chestEmojiName)} ${p.chestLabel}s left: **${p.remaining}** ・ 💡 \`crd equip <id>\``
      )
    );

  return { components: [container], files: [grid.file] };
}

/**
 * Run the full animated open. The DB work MUST already be committed — this is
 * display-only; on any failure it falls through to posting the result directly.
 *
 * @param {import('discord.js').Message} message  the invoking command message
 * @param {object} opts
 * @param {string}   opts.gifKey        key of CHEST_GIFS
 * @param {string}   opts.animTitle     header for the animation phase
 * @param {Function} opts.buildResult   async () => { components, files } (CV2, no flags)
 */
async function playAnimatedOpen(message, { gifKey, gifPath, animTitle, buildResult }) {
  const g = resolveGif(gifKey, gifPath);
  if (!g) throw new Error(`playAnimatedOpen: unknown gifKey ${gifKey}`);
  const gifOnDisk = assetExistsSync(g.src);

  let msg = null;
  let result = null;
  try {
    if (gifOnDisk) {
      // Pre-render the result DURING the animation so the edit lands instantly.
      msg = await message.reply(await animationPayload(gifKey, animTitle, gifPath));
      [result] = await Promise.all([buildResult(), sleep(ANIMATION_MS)]);
    } else {
      // gif missing → skip the suspense phase, results only.
      result = await buildResult();
    }
  } catch (err) {
    // Rolls are committed — never swallow them. Try to still build/show results.
    console.error(`[chestOpen] animation phase failed (${gifKey}):`, err.message);
    if (!result) result = await buildResult();
  }

  const resultPayload = () => ({
    components: result.components,
    files: result.files,
    attachments: [], // required: drops the previous gif/grid attachment
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { repliedUser: false },
  });

  if (msg) {
    await msg.edit(resultPayload());
  } else {
    msg = await message.reply(resultPayload());
  }
  return msg;
}

/**
 * Rune-bag result container (mirrors the weapon grid; §2.3 "same as Weapons display").
 * @param {object} p
 * @param {string} p.gifKey         bag gif key (flavor lookup)
 * @param {string} p.title          e.g. 'Opened 5 × Lesser Rune Bag'
 * @param {Array}  p.items          [{ id, name, tier, stats }, …] renderer shape
 * @param {number} p.remaining      bags of this type left
 * @param {string} p.bagLabel       display label, e.g. 'Lesser Rune Bag'
 * @param {string} p.bagEmoji       inline emoji string for the bag
 */
async function buildRuneResultPayload(p) {
  const grid = await makeOptimizedAttachment(await renderWeaponResults(p.items), 'rune_results');

  const container = new ContainerBuilder()
    .setAccentColor(0x9b59b6)
    .addTextDisplayComponents((td) =>
      td.setContent(`## ✨ ${p.title}\n*${CHEST_FLAVOR[p.gifKey] ?? 'The bag spills open...'}*`)
    )
    .addSeparatorComponents(sep)
    .addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL(grid.url))
    )
    .addTextDisplayComponents((td) => td.setContent(tierSummary(p.items)))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(`-# ${p.bagEmoji} ${p.bagLabel}s left: **${p.remaining}** ・ 💡 \`crd runes\` ・ \`crd socket <gear_id> <rune_uid> <slot#>\``)
    );

  return { components: [container], files: [grid.file] };
}

module.exports = { playAnimatedOpen, buildWeaponResultPayload, buildRuneResultPayload, tierSummary, CHEST_GIFS, CHEST_FLAVOR };
