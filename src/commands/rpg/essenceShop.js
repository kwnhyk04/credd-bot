'use strict';

/**
 * essenceShop.js — `crd essence shop` (Phase 2 §2.7).
 *
 * Components-V2 container styled like the supporter shop, with an essence-icon
 * header. Lists the 6 one-way exchange items (ids 1-6: 3 rune bags + 3 essence
 * tier-ups). Buying is `crd exchange <id>` (see exchange.js). One row per item:
 * id · emoji · name · cost (essence + Credux).
 *
 * Routed by the canonical first token `essence`; only `crd essence shop` is live.
 */

const {
  ContainerBuilder, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emoji } = require('../../utils/emojis');
const { ESSENCE_SHOP } = require('../../config/runes');

const BRAND = 0x9b59b6;

async function buildEssenceShop(viewerId) {
  const { rows } = await pool.query(
    `SELECT credux, epic_essence, mythic_essence, legendary_essence, supreme_essence
       FROM users_bag WHERE discord_id = $1`,
    [viewerId]
  );
  const bag = rows[0] || {};
  const coin = emoji('credux_coin');

  // Boxed-row canvas: id (left) · image · name, with the exchange cost right-aligned.
  const rowsText = ESSENCE_SHOP.map((it) => {
    const isBag = it.grant.column.endsWith('_rune_bag');
    const bagKey = isBag ? it.grant.column.replace('_rune_bag', '') : null;
    const iconName = isBag ? `${bagKey}_bag` : it.emojiName;
    return `\`${it.id}\` ${emoji(iconName)} **${it.name}** - **${it.cost.amount}** ${emoji(`${it.cost.essence}_essence`)} + ${coin} **${it.cost.credux.toLocaleString()}**`;
  }).join('\n');

  const container = new ContainerBuilder().setAccentColor(BRAND);
  container.addTextDisplayComponents((td) => td.setContent(`## ${emoji('general_essence')} Essence Shop`));
  container.addTextDisplayComponents((td) => td.setContent(
    '-# Rune bags — buy with `crd exchange <lb|gb|db> [qty]`. '
    + 'Essence tier-ups moved to `crd exchange essence`.'
  ));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(rowsText));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    `-# Your essence — `
    + `${emoji('epic_essence')} ${bag.epic_essence ?? 0} · ${emoji('mythic_essence')} ${bag.mythic_essence ?? 0} · `
    + `${emoji('legendary_essence')} ${bag.legendary_essence ?? 0} · ${emoji('supreme_essence')} ${bag.supreme_essence ?? 0} · `
    + `${coin} ${Number(bag.credux ?? 0).toLocaleString()}`
  ));

  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function execute(message, { args }) {
  if ((args[0] || '').toLowerCase() !== 'shop') {
    return message.reply({ content: 'Usage: `crd essence shop` — then `crd exchange <id>` to buy.', allowedMentions: { repliedUser: false } });
  }
  const payload = await buildEssenceShop(message.author.id);
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

module.exports = { execute, buildEssenceShop };
