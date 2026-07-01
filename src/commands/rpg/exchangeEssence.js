'use strict';

/**
 * exchangeEssence.js — `crd exchange essence` (Phase 6, §E).
 *
 * The essence tier-up shop, re-skinned as a CONTINUOUS forge-style view (like
 * `crd enhance`): a tier dropdown in the header (Mythic / Legendary / Supreme),
 * the conversion requirement (10 lower-tier essence + Credux → 1), live balances,
 * and a Convert button that resolves one conversion and re-renders in place so the
 * player can convert as many as they want, then stop. One-way only (never downward).
 *
 * customIds: essx:tier:<owner> (select) · essx:convert:<owner>:<tier> (button).
 */

const {
  ContainerBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emoji } = require('../../utils/emojis');
const { ESSENCE_COLUMN, ESSENCE_CONVERT } = require('../../config/runes');

const BRAND = 0x9b59b6;
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;
const TIERS = Object.keys(ESSENCE_CONVERT); // ['mythic','legendary','supreme']

/** Read all essence balances + credux for one player. */
async function fetchBalances(discordId) {
  const { rows } = await pool.query(
    `SELECT credux, epic_essence, mythic_essence, legendary_essence, supreme_essence
       FROM users_bag WHERE discord_id = $1`,
    [discordId]
  );
  return rows[0] || null;
}

function tierSelectRow(tier, ownerId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`essx:tier:${ownerId}`)
    .setPlaceholder('Choose essence to craft')
    .addOptions(TIERS.map((t) => ({
      label: ESSENCE_CONVERT[t].targetName, value: t, default: t === tier,
    })));
  return new ActionRowBuilder().addComponents(menu);
}

function convertButtonRow(tier, ownerId, enabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`essx:convert:${ownerId}:${tier}`)
      .setLabel('♻️ Convert')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!enabled),
  );
}

/**
 * Build the continuous exchange view for a tier. `resultLine`/`color` decorate the
 * card after a conversion. Returns a full CV2 payload (container + select + button).
 */
function buildPayload(bag, tier, ownerId, { resultLine = null, color = null } = {}) {
  const def = ESSENCE_CONVERT[tier];
  const fromCol = ESSENCE_COLUMN[def.from];
  const haveFrom = Number(bag[fromCol] || 0);
  const haveTarget = Number(bag[def.target] || 0);
  const credux = Number(bag.credux || 0);
  const canAfford = haveFrom >= def.amount && credux >= def.credux;

  const container = new ContainerBuilder()
    .setAccentColor(color ?? BRAND)
    .addTextDisplayComponents((td) => td.setContent(`## ${emoji('general_essence')} Essence Exchange`));
  // Dropdown lives in the header (pick which essence to craft).
  container.addActionRowComponents(() => tierSelectRow(tier, ownerId));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    `**Craft ${def.targetName}**\n`
    + `Requirement: **${def.amount}** ${emoji(`${def.from}_essence`)} ${def.from} essence `
    + `+ **${def.credux.toLocaleString()}** ${emoji('credux_coin')} Credux  →  **1** ${emoji(def.target)}`
  ));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    `-# You have ${emoji(`${def.from}_essence`)} ${haveFrom} · ${emoji(def.target)} ${haveTarget} · ${emoji('credux_coin')} ${credux.toLocaleString()}`
  ));
  if (resultLine) {
    container.addSeparatorComponents(sep);
    container.addTextDisplayComponents((td) => td.setContent(resultLine));
  }

  return {
    components: [container, convertButtonRow(tier, ownerId, canAfford)],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function execute(message, { args }) {
  const ownerId = message.author.id;
  const bag = await fetchBalances(ownerId);
  if (!bag) {
    return message.reply({ content: 'You have no bag yet — `crd register` first.', allowedMentions: { repliedUser: false } });
  }
  // Optional starting tier (`crd exchange essence supreme`); default Mythic.
  const want = (args[0] || '').toLowerCase();
  const tier = TIERS.includes(want) ? want : 'mythic';
  return message.reply({ ...buildPayload(bag, tier, ownerId), allowedMentions: { repliedUser: false } });
}

/** Select: essx:tier:<owner> — switch which essence is being crafted. */
async function handleSelect(interaction) {
  const ownerId = interaction.customId.split(':')[2];
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Run `crd exchange essence` yourself.', flags: MessageFlags.Ephemeral });
  }
  let tier = interaction.values[0];
  if (!TIERS.includes(tier)) tier = 'mythic';
  await interaction.deferUpdate();
  try {
    const bag = await fetchBalances(ownerId);
    if (!bag) return interaction.followUp({ content: 'No bag found.', flags: MessageFlags.Ephemeral });
    return interaction.editReply(buildPayload(bag, tier, ownerId));
  } catch (err) {
    console.error('[exchangeEssence] tier select failed:', err.message);
    return interaction.followUp({ content: 'Essence exchange view failed to refresh.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

/** One atomic conversion. Deducts 10 lower-tier essence + Credux, grants 1 of the target. */
async function convertOnce(client, discordId, tier) {
  const def = ESSENCE_CONVERT[tier];
  const fromCol = ESSENCE_COLUMN[def.from];
  await client.query('BEGIN');
  const bagRes = await client.query(
    `SELECT credux, ${fromCol} AS have FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
    [discordId]
  );
  if (bagRes.rows.length === 0) { await client.query('ROLLBACK'); return { status: 'notfound' }; }
  const have = Number(bagRes.rows[0].have);
  const credux = Number(bagRes.rows[0].credux);
  if (have < def.amount || credux < def.credux) {
    await client.query('ROLLBACK');
    return { status: 'insufficient' };
  }
  await client.query(
    `UPDATE users_bag
        SET ${fromCol} = ${fromCol} - $2, credux = credux - $3, ${def.target} = ${def.target} + 1
      WHERE discord_id = $1`,
    [discordId, def.amount, def.credux]
  );
  await client.query(
    `INSERT INTO game_logs (discord_id, action, item_type) VALUES ($1, 'Exchange', $2)`,
    [discordId, def.target]
  ).catch(() => {});
  await client.query('COMMIT');
  return { status: 'done' };
}

/** Button: essx:convert:<owner>:<tier> — convert one, re-render in place. */
async function handleConvert(interaction, ownerId, tier) {
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'This exchange isn\'t yours.', flags: MessageFlags.Ephemeral });
  }
  if (!TIERS.includes(tier)) tier = 'mythic';
  const def = ESSENCE_CONVERT[tier];

  await interaction.deferUpdate();
  let client;
  let result;
  try {
    client = await pool.connect();
    result = await convertOnce(client, ownerId, tier);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[exchangeEssence] convert failed:', err.message);
    return interaction.followUp({ content: 'Conversion failed — nothing was spent.', flags: MessageFlags.Ephemeral }).catch(() => {});
  } finally {
    if (client) client.release();
  }

  try {
    const bag = await fetchBalances(ownerId);
    if (!bag || result.status === 'notfound') {
      return interaction.editReply(buildPayload(bag || {}, tier, ownerId, { resultLine: '❌ No bag found.', color: RED }));
    }
    if (result.status === 'insufficient') {
      return interaction.editReply(buildPayload(bag, tier, ownerId, {
        resultLine: `❌ Not enough materials — need ${def.amount} ${def.from} essence + ${def.credux.toLocaleString()} Credux.`,
        color: RED,
      }));
    }
    return interaction.editReply(buildPayload(bag, tier, ownerId, {
      resultLine: `✅ Crafted **1× ${def.targetName}** ${emoji(def.target)}`,
      color: GREEN,
    }));
  } catch (err) {
    console.error('[exchangeEssence] convert refresh failed:', err.message);
    return interaction.followUp({
      content: result.status === 'done'
        ? 'Conversion completed, but the exchange view could not refresh. Run `crd exchange essence` to reload balances.'
        : 'Exchange view failed to refresh. Run `crd exchange essence` to reload balances.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

module.exports = { execute, handleSelect, handleConvert, buildPayload };
