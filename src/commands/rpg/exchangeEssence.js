'use strict';

/**
 * exchangeEssence.js — `crd exchange essence` (Phase 6, §E).
 *
 * The essence tier-up shop, re-skinned as a CONTINUOUS forge-style view (like
 * `crd enhance`): a tier dropdown in the header (Mythic / Legendary / Supreme),
 * the conversion requirement (10 lower-tier essence + Credux → 1), live balances,
 * and a Convert button that opens a quantity modal for an atomic bulk conversion.
 * One-way only (never downward).
 *
 * customIds: essx:tier:<owner> (select) · essx:convert:<owner>:<tier> (button)
 * · essx:amount:<owner>:<tier>:<submission> (modal).
 */

const {
  ContainerBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { randomUUID } = require('crypto');
const pool = require('../../db/pool');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emoji } = require('../../utils/emojis');
const { ESSENCE_COLUMN, ESSENCE_CONVERT } = require('../../config/runes');

const BRAND = 0x9b59b6;
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;
const TIERS = Object.keys(ESSENCE_CONVERT); // ['mythic','legendary','supreme']
const BALANCE_COLUMNS = ['credux', 'epic_essence', 'mythic_essence', 'legendary_essence', 'supreme_essence'];
const BALANCE_SELECT = BALANCE_COLUMNS.join(', ');
const MAX_BULK_CONVERSIONS = 1_000_000;

/** Read all essence balances + credux for one player. */
async function fetchBalances(discordId) {
  const { rows } = await pool.query(
    `SELECT ${BALANCE_SELECT}
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

function parseConversionAmount(raw) {
  const value = String(raw ?? '').trim();
  if (!/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_BULK_CONVERSIONS
    ? amount
    : null;
}

function maxAffordableConversions(def, bag) {
  const fromCol = ESSENCE_COLUMN[def.from];
  const haveFrom = Math.max(0, Number(bag?.[fromCol] || 0));
  const credux = Math.max(0, Number(bag?.credux || 0));
  return Math.min(
    Math.floor(haveFrom / def.amount),
    Math.floor(credux / def.credux),
    MAX_BULK_CONVERSIONS,
  );
}

function insufficientConversionLine(def, amount, bag, maxConversions) {
  const fromCol = ESSENCE_COLUMN[def.from];
  const requiredFrom = def.amount * amount;
  const requiredCredux = def.credux * amount;
  return `You cannot complete **${amount.toLocaleString()}** conversions.\n\n`
    + '**Required:**\n'
    + `${requiredFrom.toLocaleString()} ${def.from} Essence\n`
    + `${requiredCredux.toLocaleString()} Credux\n\n`
    + '**You currently have:**\n'
    + `${Number(bag?.[fromCol] || 0).toLocaleString()} ${def.from} Essence\n`
    + `${Number(bag?.credux || 0).toLocaleString()} Credux\n\n`
    + `**Maximum available conversions:** ${maxConversions.toLocaleString()}`;
}

/** One atomic bulk conversion with a durable one-modal submission guard. */
async function convertBulk(client, discordId, tier, amount, submissionId) {
  const def = ESSENCE_CONVERT[tier];
  const fromCol = ESSENCE_COLUMN[def.from];
  await client.query('BEGIN');

  const claim = await client.query(
    `INSERT INTO essence_exchange_submissions (submission_id, discord_id)
     VALUES ($1, $2)
     ON CONFLICT (submission_id) DO NOTHING
     RETURNING submission_id`,
    [submissionId, discordId],
  );
  if (claim.rows.length === 0) {
    await client.query('ROLLBACK');
    return { status: 'duplicate' };
  }

  const bagRes = await client.query(
    `SELECT ${BALANCE_SELECT} FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
    [discordId]
  );
  if (bagRes.rows.length === 0) { await client.query('ROLLBACK'); return { status: 'notfound' }; }
  const bag = bagRes.rows[0];
  const maxConversions = maxAffordableConversions(def, bag);
  if (amount > maxConversions) {
    await client.query('ROLLBACK');
    return { status: 'insufficient', bag, maxConversions };
  }

  const requiredFrom = def.amount * amount;
  const requiredCredux = def.credux * amount;
  await client.query(
    `UPDATE users_bag
        SET ${fromCol} = ${fromCol} - $2, credux = credux - $3, ${def.target} = ${def.target} + $4
      WHERE discord_id = $1`,
    [discordId, requiredFrom, requiredCredux, amount]
  );
  await client.query(
    `INSERT INTO game_logs (discord_id, action, item_type) VALUES ($1, 'Exchange', $2)`,
    [discordId, def.target]
  );
  const updated = await client.query(
    `SELECT ${BALANCE_SELECT} FROM users_bag WHERE discord_id = $1`,
    [discordId]
  );
  await client.query('COMMIT');
  return {
    status: 'done',
    amount,
    requiredFrom,
    requiredCredux,
    bag: updated.rows[0],
  };
}

function amountModal(ownerId, tier) {
  const submissionId = randomUUID();
  const amountInput = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('Conversion Amount')
    .setPlaceholder('Enter the number of conversions')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const modal = new ModalBuilder()
    .setCustomId(`essx:amount:${ownerId}:${tier}:${submissionId}`)
    .setTitle('Convert Essence')
    .addComponents(new ActionRowBuilder().addComponents(amountInput));
  return modal;
}

/** Button: essx:convert:<owner>:<tier> — open the bulk conversion modal. */
async function handleConvert(interaction, ownerId, tier) {
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'This exchange isn\'t yours.', flags: MessageFlags.Ephemeral });
  }
  if (!TIERS.includes(tier)) tier = 'mythic';
  return interaction.showModal(amountModal(ownerId, tier));
}

/** Modal: essx:amount:<owner>:<tier>:<submission> — perform the requested bulk exchange. */
async function handleModalSubmit(interaction, ownerId, tier, submissionId) {
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'This exchange isn\'t yours.', flags: MessageFlags.Ephemeral });
  }
  if (!TIERS.includes(tier) || !/^[0-9a-f-]{36}$/i.test(submissionId || '')) {
    return interaction.reply({ content: 'This conversion form is no longer valid. Run `crd exchange essence` again.', flags: MessageFlags.Ephemeral });
  }

  let rawAmount;
  let client;
  try {
    rawAmount = interaction.fields.getTextInputValue('amount');
  } catch {
    return interaction.reply({ content: 'Enter the number of conversions.', flags: MessageFlags.Ephemeral });
  }
  const amount = parseConversionAmount(rawAmount);
  if (amount === null) {
    return interaction.reply({
      content: `Enter a positive whole number from 1 to ${MAX_BULK_CONVERSIONS.toLocaleString()}. Decimals, negatives, and other text are not accepted.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const def = ESSENCE_CONVERT[tier];
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let result;
  try {
    client = await pool.connect();
    result = await convertBulk(client, ownerId, tier, amount, submissionId);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[exchangeEssence] bulk convert failed:', err.message);
    return interaction.editReply({ content: 'Conversion failed — nothing was spent.' }).catch(() => {});
  } finally {
    if (client) client.release();
  }

  if (result.status === 'duplicate') {
    return interaction.editReply({ content: 'This conversion form was already processed. No additional essence was granted.' });
  }
  if (result.status === 'notfound') {
    return interaction.editReply({ content: 'You have no bag yet — `crd register` first.' });
  }
  if (result.status === 'insufficient') {
    return interaction.editReply({ content: insufficientConversionLine(def, amount, result.bag, result.maxConversions) });
  }

  const bag = result.bag;
  await interaction.editReply({
    content: 'Conversion Successful\n\n'
      + `Completed: ${result.amount.toLocaleString()} conversions\n`
      + `Used: ${result.requiredFrom.toLocaleString()} ${def.from} Essence\n`
      + `Used: ${result.requiredCredux.toLocaleString()} Credux\n`
      + `Received: ${result.amount.toLocaleString()} ${def.targetName}\n\n`
      + '**Updated balances:**\n'
      + `${def.from} Essence: ${Number(bag[ESSENCE_COLUMN[def.from]] || 0).toLocaleString()}\n`
      + `${def.targetName}: ${Number(bag[def.target] || 0).toLocaleString()}\n`
      + `Credux: ${Number(bag.credux || 0).toLocaleString()}`,
  });

  if (interaction.message) {
    await interaction.message.edit(buildPayload(bag, tier, ownerId, {
      resultLine: `✅ Crafted **${result.amount.toLocaleString()}× ${def.targetName}** ${emoji(def.target)}`,
      color: GREEN,
    })).catch((err) => console.warn('[exchangeEssence] view refresh failed:', err.message));
  }
}

module.exports = {
  execute, handleSelect, handleConvert, handleModalSubmit, buildPayload,
  parseConversionAmount, maxAffordableConversions, convertBulk,
  MAX_BULK_CONVERSIONS,
};
