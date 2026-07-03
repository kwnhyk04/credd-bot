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
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const pool = require('../db/pool');
const { smallDivider: sep } = require('../utils/componentsV2');
const { emoji } = require('../utils/emojis');
const { CHESTS: CHEST_DROPS } = require('../config/dropRates');

// [Jun-2026 §7] help_icon custom emoji for the interactive "?" on the chests view.
const HELP_ICON = { id: '1517665553261662370', name: 'help_icon' };

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

const RELICS = [
  { code: 'sr', name: 'Sacred Relic',  emojiName: 'sacred_relic',  countKey: 'sacred',  openCmd: 'crd open sr' },
  { code: 'supr', name: 'Supreme Relic', emojiName: 'supreme_relic', countKey: 'supreme', openCmd: 'crd open supr' },
];

function buildDropRatesButton(ownerId) {
  return new ButtonBuilder()
    .setCustomId(`chests:rates:${ownerId}`)
    .setEmoji(HELP_ICON)
    .setLabel('Drop rates')
    .setStyle(ButtonStyle.Secondary);
}

function buildChestIdButton(ownerId, code) {
  return new ButtonBuilder()
    .setCustomId(`chests:id:${ownerId}:${code}`)
    .setLabel(code)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);
}

/* ════════════════════════════════════════════
 * CRD BAG — overview
 * One container; separator line between every section.
 *
 * data = {
 *   credux, beliefShards,
 *   chests:  { sc, gc, btc, bgtc, supc },
 *   essence: { epic, mythic, legendary, supreme },
 *   relics:  { sacred, supreme },
 *   counts:  { weapons, armors, runes, chests, runeBags },
 * }
 * ══════════════════════════════════════════ */
async function buildBagOverview(user, data) {
  const rows = [
    `\u2694\uFE0F **Weapons**  -# \`crd bag weapons\``,
    `\uD83D\uDEE1\uFE0F **Armors**  -# \`crd bag armors\``,
    `${emoji('general_chest')} **Chests**  -# \`crd bag chests\``,
    `${emoji('bag')} **Rune Bag**  -# \`crd rune bag\``,
    `${emoji('rune_icon')} **Runes**  -# \`crd runes\``,
  ];

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents((td) => td.setContent(`## ${emoji('bag')} <@${user.id}>'s Bag`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(
        `${emoji('credux_coin')} Credux: **${(data.credux ?? 0).toLocaleString()}** ・ ` +
        `${emoji('belief_shards')} Belief Shards: **${(data.beliefShards ?? 0).toLocaleString()}**`
      )
    )
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(rows.join('\n')));

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
  const rows = [
    ...CHESTS.map((c) => ({
      code: c.code,
      text: `${emoji(c.emojiName)} **${c.name}** - **${Number(counts[c.code] ?? 0).toLocaleString()}**`,
    })),
    ...RELICS.map((r) => ({
      code: r.code,
      text: `${emoji(r.emojiName)} **${r.name}** - **${Number(counts[r.countKey] ?? 0).toLocaleString()}**`,
    })),
  ];

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    // ── Header (real mention; payload carries allowedMentions parse: []) ──
    .addSectionComponents((section) => section
      .addTextDisplayComponents((td) => td.setContent(`## ${emoji('bag')} <@${user.id}>'s Chests`))
      .setButtonAccessory(buildDropRatesButton(user.id)))
    .addSeparatorComponents(sep);

  for (const row of rows) {
    container.addSectionComponents((section) => section
      .addTextDisplayComponents((td) => td.setContent(row.text))
      .setButtonAccessory(buildChestIdButton(user.id, row.code)));
  }

  container
    // ── Body: rendered boxed rows ──
    .addSeparatorComponents(sep)
    // ── Footer ──
    .addTextDisplayComponents((td) =>
      td.setContent('-# 💡 Open up to 10 at once, e.g. `crd open sc 10` (Supreme: 1) ・ `crd bag`')
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/* ════════════════════════════════════════════
 * [Jun-2026 §7] WEAPON DROP RATES PER BOX — ephemeral embed
 * Sourced LIVE from config/dropRates.CHESTS so the numbers never drift from the
 * real roll table. Each chest lists its weapon-tier percentage breakdown.
 * ══════════════════════════════════════════ */
function buildDropRatesEmbed() {
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`${emoji('bag')} Weapon Drop Rates per Box`)
    .setDescription('-# Weapon tier odds for each chest, straight from the live drop table.');

  for (const [code, def] of Object.entries(CHEST_DROPS)) {
    const chest = CHESTS.find((item) => item.code === code);
    const lines = def.drops
      .map(([tier, p]) => `${tier}: **${(p * 100).toFixed(p * 100 % 1 === 0 ? 0 : 1)}%**`)
      .join('\n');
    embed.addFields({
      name: `${emoji(chest?.emojiName)} ${def.action}`,
      value: lines,
      inline: true,
    });
  }
  return embed;
}

/** Button `chests:rates:<ownerId>` — owner-only ephemeral drop-rate embed. */
async function handleChestRatesButton(interaction) {
  const ownerId = interaction.customId.split(':')[2];
  if (ownerId && interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'This isn\'t your bag view — run `crd bag` yourself!',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  await interaction.reply({
    embeds: [buildDropRatesEmbed()],
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

/** Read chest + relic counts for the view (DB → { sc, gc, btc, bgtc, supc, sacred, supreme } | null). */
async function getChestCounts(discordId) {
  const { rows } = await pool.query(
    `SELECT silver_chest, gold_chest, boss_treasure_chest, boss_golden_chest, supreme_chest,
            sacred_relics, supreme_relics
       FROM users_bag WHERE discord_id = $1`,
    [discordId]
  );
  const b = rows[0];
  if (!b) return null;
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

module.exports = {
  buildBagOverview, buildChestsView, getChestCounts, CHESTS,
  buildDropRatesEmbed, handleChestRatesButton,
  HELP_ICON, // [addendum3 §1] reused as the shop/collection Preview button emoji
};
