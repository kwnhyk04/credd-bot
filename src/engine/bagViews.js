'use strict';

/**
 * bagViews.js — display builders for `crd bag` and `crd bag chests`
 *
 *   buildBagOverview(user, data)   → single container, separator per section
 *   buildChestsView(user, counts)  → multi-container "boxed rows" + Open buttons
 *   handleOpenChestButton(i)       → opens 1 chest (same txn as `crd open`), refreshes view
 *
 * Both builders return a full message payload: pass straight to message.reply(...)
 * or interaction.update(...).
 *
 * Chest types are HARDCODED constants here — only the counts come from
 * the database. Emoji icons come from utils/emojis.js (parsed from game_items.txt).
 *
 * Requires discord.js v14.19+ (Components V2).
 */

const {
  ContainerBuilder,
  SeparatorSpacingSize,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const pool = require('../db/pool');
const { emoji } = require('../utils/emojis');
const { renderBagItemsImage } = require('./renderBagItems');

/* ════════════════════════════════════════════
 * CONFIG
 * ══════════════════════════════════════════ */
const ACCENT = 0x9b59b6;

// Fixed chest definitions: name, emoji key, open command, count code
const CHESTS = [
  { code: 'sc',   name: 'Silver Chest',        emojiName: 'silver_chest',        openCmd: 'crd open sc' },
  { code: 'gc',   name: 'Gold Chest',          emojiName: 'gold_chest',          openCmd: 'crd open gc' },
  { code: 'btc',  name: 'Boss Treasure Chest', emojiName: 'boss_treasure_chest', openCmd: 'crd open btc' },
  { code: 'bgtc', name: 'Boss Golden Chest',   emojiName: 'boss_golden_chest',   openCmd: 'crd open bgtc' },
  { code: 'supc', name: 'Supreme Chest',       emojiName: 'supreme_chest',       openCmd: 'crd open supc' },
];

const ESSENCES = [
  { name: 'Epic',      emojiName: 'epic_essence' },
  { name: 'Mythic',    emojiName: 'mythic_essence' },
  { name: 'Legendary', emojiName: 'legendary_essence' },
  { name: 'Supreme',   emojiName: 'supreme_essence' },
];

const RELICS = [
  { name: 'Sacred Relic',  emojiName: 'sacred_relic',  countKey: 'sacred',  openCmd: 'crd open sr' },
  { name: 'Supreme Relic', emojiName: 'supreme_relic', countKey: 'supreme', openCmd: 'crd open supr' },
];

const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);

/* ════════════════════════════════════════════
 * CRD BAG — overview
 * One container; separator line between every section.
 *
 * data = {
 *   credux, beliefShards,
 *   chests:  { sc, gc, btc, bgtc, supc },
 *   essence: { epic, mythic, legendary, supreme },
 *   relics:  { sacred, supreme },
 * }
 * ══════════════════════════════════════════ */
function buildBagOverview(user, data) {
  // Chests + Essence: one item per line (mobile-friendly vertical lists).
  const chestLines = CHESTS
    .map((c) => `${emoji(c.emojiName)} ${c.name.replace(' Chest', '')}: **${data.chests[c.code] ?? 0}**`)
    .join('\n');

  const essenceLines = ESSENCES
    .map((e) => `${emoji(e.emojiName)} ${e.name}: **${data.essence[e.name.toLowerCase()] ?? 0}**`)
    .join('\n');

  const relicLine =
    `${emoji('sacred_relic')} Sacred Relic: **${data.relics.sacred ?? 0}** ・ ` +
    `${emoji('supreme_relic')} Supreme Relic: **${data.relics.supreme ?? 0}**`;

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    // ── Header (real mention; reply sets allowedMentions parse: [] — no ping) ──
    .addTextDisplayComponents((td) => td.setContent(`## ${emoji('bag')} <@${user.id}>'s Bag`))
    .addSeparatorComponents(sep)
    // ── Currencies (no dedicated "general" currency icon → use the Credux coin) ──
    .addTextDisplayComponents((td) =>
      td.setContent(
        `**${emoji('credux_coin')} Currencies**\n\n` +
        `${emoji('credux_coin')} Credux: **${(data.credux ?? 0).toLocaleString()}** ・ ` +
        `${emoji('belief_shards')} Belief Shards: **${(data.beliefShards ?? 0).toLocaleString()}**`
      )
    )
    .addSeparatorComponents(sep)
    // ── Chests ──
    .addTextDisplayComponents((td) => td.setContent(`**${emoji('general_chest')} Chests**\n\n${chestLines}`))
    .addSeparatorComponents(sep)
    // ── Essence ──
    .addTextDisplayComponents((td) => td.setContent(`**${emoji('general_essence')} Essence**\n\n${essenceLines}`))
    .addSeparatorComponents(sep)
    // ── Relics ──
    .addTextDisplayComponents((td) => td.setContent(`**${emoji('general_relic')} Relics**\n\n${relicLine}`))
    .addSeparatorComponents(sep)
    // ── Footer: help only ──
    .addTextDisplayComponents((td) =>
      td.setContent('-# 💡 `crd bag chests` ・ `crd bag weapons`')
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/* ════════════════════════════════════════════
 * CRD BAG CHESTS — canvas-rendered boxed rows
 * ONE container: header (mention) → separator → MediaGallery with the
 * rendered rows image (5 chests + 2 relics) → separator → footer text.
 * Image re-rendered per invocation; emoji icons are disk-cached (renderBagItems).
 *
 * counts = { sc, gc, btc, bgtc, supc, sacred, supreme }
 * ══════════════════════════════════════════ */
async function buildChestsView(user, counts) {
  const items = [
    ...CHESTS.map((c) => ({ emojiName: c.emojiName, name: c.name, count: counts[c.code] ?? 0, cmd: c.openCmd })),
    ...RELICS.map((r) => ({ emojiName: r.emojiName, name: r.name, count: counts[r.countKey] ?? 0, cmd: r.openCmd })),
  ];
  const buffer = await renderBagItemsImage(items);
  const file = new AttachmentBuilder(buffer, { name: 'bag_chests.png' });

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    // ── Header (real mention; payload carries allowedMentions parse: []) ──
    .addTextDisplayComponents((td) => td.setContent(`## 🧰 <@${user.id}>'s Chests`))
    .addSeparatorComponents(sep)
    // ── Body: rendered boxed rows ──
    .addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL('attachment://bag_chests.png'))
    )
    .addSeparatorComponents(sep)
    // ── Footer ──
    .addTextDisplayComponents((td) =>
      td.setContent('-# 💡 Open up to 10 at once, e.g. `crd open sc 10` (Supreme: 1) ・ `crd bag`')
    );

  return {
    components: [container],
    files: [file],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/** Read chest + relic counts for the view (DB → { sc, gc, btc, bgtc, supc, sacred, supreme }). */
async function getChestCounts(discordId) {
  const { rows } = await pool.query(
    `SELECT silver_chest, gold_chest, boss_treasure_chest, boss_golden_chest, supreme_chest,
            sacred_relics, supreme_relics
       FROM users_bag WHERE discord_id = $1`,
    [discordId]
  );
  const b = rows[0] ?? {};
  return {
    sc: b.silver_chest ?? 0,
    gc: b.gold_chest ?? 0,
    btc: b.boss_treasure_chest ?? 0,
    bgtc: b.boss_golden_chest ?? 0,
    supc: b.supreme_chest ?? 0,
    sacred: b.sacred_relics ?? 0,
    supreme: b.supreme_relics ?? 0,
  };
}

module.exports = { buildBagOverview, buildChestsView, getChestCounts, CHESTS };
