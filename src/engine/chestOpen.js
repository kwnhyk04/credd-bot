'use strict';

/**
 * chestOpen.js — gif-animated open flow for chests AND relics (Components V2).
 *
 * Flow (backend has ALREADY rolled + committed before this is called):
 *   1. reply: container [header → separator → chest GIF media gallery]
 *   2. Promise.all([build result payload, play-once delay])
 *   3. EDIT the same message into the result container (attachments: [] drops
 *      the old gif — required or discord.js keeps it attached)
 *   4. Replay button (opener-only) re-attaches the gif, waits, then swaps back
 *      to the SAME pre-rendered result. Never re-rolls.
 *
 * The result payload is caller-supplied (weapon grid via buildWeaponResultPayload,
 * or renderSummon's deity container for relics) so both paths share one runner.
 */

const {
  ContainerBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const { renderWeaponResults, TIERS } = require('./weaponResultRenderer');
const { emoji } = require('../utils/emojis');

const ANIM_DIR = path.join(__dirname, '..', '..', 'assets', 'animations', 'chests');
const ANIMATION_MS = 3000; // matches the ~2.5s GIFs + buffer
const REPLAY_WINDOW_MS = 120_000;

// gifKey (users_bag column / relic kind) → gif filename in assets/animations/chests
const CHEST_GIFS = {
  silver_chest: 'silver_chest.gif',
  gold_chest: 'gold_chest.gif',
  boss_treasure_chest: 'boss_treasure_chest.gif',
  boss_golden_chest: 'boss_golden_chest.gif',
  supreme_chest: 'supreme_chest.gif',
  sacred_relic: 'sacred_relic.gif',
  supreme_relic: 'supreme_relic.gif',
};

const CHEST_FLAVOR = {
  silver_chest: 'The silver lock gives way. Steel and fortune spill forth.',
  gold_chest: 'The gold yielded its secrets. These weapons are now yours to wield.',
  boss_treasure_chest: 'The boss’s hoard cracks open. Power answers the victor.',
  boss_golden_chest: 'Gilded and cursed — the golden hoard surrenders its arms.',
  supreme_chest: 'Light pours from the supreme vault. Few have seen what lies within.',
  sacred_relic: 'The sacred relic burns away, leaving its blessing behind.',
  supreme_relic: 'The supreme relic shatters — raw light forged into steel.',
};

// Weapon tiers rarest-first for the summary line.
const TIER_ORDER = ['supreme', 'legendary', 'mythic', 'rare', 'common'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);
const cap = (s = '') => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** e.g. `★ **Legendary** ×1 ・ ❖ **Mythic** ×4` (rarest first). */
function tierSummary(items) {
  const counts = {};
  for (const it of items) {
    const k = (it.tier || 'common').toLowerCase();
    counts[k] = (counts[k] || 0) + 1;
  }
  return TIER_ORDER
    .filter((t) => counts[t])
    .map((t) => `${TIERS[t]?.icon || '•'} **${cap(t)}** ×${counts[t]}`)
    .join(' ・ ');
}

/** Animation-phase container: header → separator → the chest gif. */
function animationPayload(gifKey, animTitle) {
  const gifName = CHEST_GIFS[gifKey];
  const container = new ContainerBuilder()
    .setAccentColor(0xf0b232)
    .addTextDisplayComponents((td) =>
      td.setContent(`## ✨ ${animTitle}\n*${CHEST_FLAVOR[gifKey] ?? 'The chest creaks open...'}*`)
    )
    .addSeparatorComponents(sep)
    .addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL(`attachment://${gifName}`))
    );
  return {
    components: [container],
    files: [new AttachmentBuilder(path.join(ANIM_DIR, gifName), { name: gifName })],
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
  const buffer = await renderWeaponResults(p.items);
  const grid = new AttachmentBuilder(buffer, { name: 'chest_results.png' });

  const container = new ContainerBuilder()
    .setAccentColor(0xf0b232)
    .addTextDisplayComponents((td) =>
      td.setContent(`## ✨ ${p.title}\n*${CHEST_FLAVOR[p.gifKey] ?? 'The chest creaks open...'}*`)
    )
    .addSeparatorComponents(sep)
    .addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL('attachment://chest_results.png'))
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

  return { components: [container], files: [grid] };
}

/**
 * Run the full animated open. The DB work MUST already be committed — this is
 * display-only; on any failure it falls through to posting the result directly.
 *
 * @param {import('discord.js').Message} message  the invoking command message
 * @param {object} opts
 * @param {string}   opts.gifKey        key of CHEST_GIFS
 * @param {string}   opts.animTitle     header for the animation phase
 * @param {string}   opts.userId        restricts Replay to the opener
 * @param {Function} opts.buildResult   async () => { components, files } (CV2, no flags)
 */
async function playAnimatedOpen(message, { gifKey, animTitle, userId, buildResult }) {
  const gifName = CHEST_GIFS[gifKey];
  if (!gifName) throw new Error(`playAnimatedOpen: unknown gifKey ${gifKey}`);
  const gifOnDisk = fs.existsSync(path.join(ANIM_DIR, gifName));

  let msg = null;
  let result = null;
  try {
    if (gifOnDisk) {
      // Pre-render the result DURING the animation so the edit lands instantly.
      msg = await message.reply(animationPayload(gifKey, animTitle));
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

  const replayRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`chestreplay:${gifKey}:${userId}`)
      .setLabel('Replay')
      .setEmoji('🔁')
      .setStyle(ButtonStyle.Secondary)
  );

  const resultPayload = (withReplay) => ({
    components: withReplay ? [...result.components, replayRow] : result.components,
    files: result.files,
    attachments: [], // required: drops the previous gif/grid attachment
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { repliedUser: false },
  });

  if (msg) {
    await msg.edit(resultPayload(gifOnDisk));
  } else {
    msg = await message.reply(resultPayload(gifOnDisk));
  }
  if (!gifOnDisk) return msg;

  // Replay: same animation, then swap back to the SAME pre-rendered results.
  const collector = msg.createMessageComponentCollector({ time: REPLAY_WINDOW_MS });
  let replaying = false;
  collector.on('collect', async (i) => {
    if (!i.customId.startsWith('chestreplay:')) return;
    if (i.user.id !== userId) {
      await i.reply({ content: 'Only the opener can replay this.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    if (replaying) { await i.deferUpdate().catch(() => {}); return; }
    replaying = true;
    try {
      await i.deferUpdate();
      const anim = animationPayload(gifKey, animTitle);
      await msg.edit({ components: anim.components, files: anim.files, attachments: [] });
      await sleep(ANIMATION_MS);
      await msg.edit(resultPayload(true));
    } catch (err) {
      console.error('[chestOpen] replay failed:', err.message);
      await msg.edit(resultPayload(true)).catch(() => {});
    } finally {
      replaying = false;
    }
  });
  collector.on('end', () => {
    msg.edit({ components: result.components }).catch(() => {});
  });
  return msg;
}

module.exports = { playAnimatedOpen, buildWeaponResultPayload, tierSummary, CHEST_GIFS, CHEST_FLAVOR };
