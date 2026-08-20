'use strict';

/**
 * chestConvert.js — `crd convert chest` / `crd cc`.
 *
 * This deliberately follows exchangeEssence.js' continuous Components V2 view:
 * one owner-gated select, one modal for the requested quantity, and one atomic
 * transaction for the actual conversion.
 *
 * customIds: chestx:type:<owner> (select) · chestx:convert:<owner>:<type>
 * (button) · chestx:amount:<owner>:<type>:<submission> (modal).
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

const BRAND = 0xf0b232;
const GREEN = 0x2ecc71;

// These are the canonical users_bag columns used by the existing bag/open/drop
// code. The shared submission table is reused for durable idempotency; no schema
// change is needed for this command.
const CHEST_BALANCE_COLUMNS = Object.freeze([
  'silver_chest',
  'gold_chest',
  'diamond_chest',
  'boss_treasure_chest',
  'boss_golden_chest',
]);
const BALANCE_SELECT = CHEST_BALANCE_COLUMNS.join(', ');

const CHEST_CONVERSIONS = Object.freeze({
  silver_gold: Object.freeze({
    sourceColumn: 'silver_chest',
    destinationColumn: 'gold_chest',
    sourceName: 'Silver Chest',
    destinationName: 'Gold Chest',
    sourceEmoji: 'silver_chest',
    destinationEmoji: 'gold_chest',
    rate: 20,
  }),
  gold_diamond: Object.freeze({
    sourceColumn: 'gold_chest',
    destinationColumn: 'diamond_chest',
    sourceName: 'Gold Chest',
    destinationName: 'Diamond Chest',
    sourceEmoji: 'gold_chest',
    destinationEmoji: 'diamond_chest',
    rate: 10,
  }),
  diamond_boss_golden: Object.freeze({
    sourceColumn: 'diamond_chest',
    destinationColumn: 'boss_golden_chest',
    sourceName: 'Diamond Chest',
    destinationName: 'Boss Golden Chest',
    sourceEmoji: 'diamond_chest',
    destinationEmoji: 'boss_golden_chest',
    rate: 10,
  }),
  boss_treasure_boss_golden: Object.freeze({
    sourceColumn: 'boss_treasure_chest',
    destinationColumn: 'boss_golden_chest',
    sourceName: 'Boss Treasure Chest',
    destinationName: 'Boss Golden Chest',
    sourceEmoji: 'boss_treasure_chest',
    destinationEmoji: 'boss_golden_chest',
    rate: 15,
  }),
});
const CONVERSION_TYPES = Object.freeze(Object.keys(CHEST_CONVERSIONS));
const DEFAULT_CONVERSION = CONVERSION_TYPES[0];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function definitionFor(type) {
  return CHEST_CONVERSIONS[type] || null;
}

function integerBalance(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** Read the five relevant chest balances for one player. */
async function fetchBalances(discordId) {
  const { rows } = await pool.query(
    `SELECT ${BALANCE_SELECT}
       FROM users_bag WHERE discord_id = $1`,
    [discordId],
  );
  return rows[0] || null;
}

function conversionSelectRow(type, ownerId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`chestx:type:${ownerId}`)
    .setPlaceholder('Choose chest conversion')
    .addOptions(CONVERSION_TYPES.map((key) => {
      const def = CHEST_CONVERSIONS[key];
      return {
        label: `${def.sourceName} → ${def.destinationName}`,
        value: key,
        description: `${def.rate} ${def.sourceName.replace(' Chest', '')} : 1 ${def.destinationName.replace(' Chest', '')}`,
        emoji: emoji(def.sourceEmoji),
        default: key === type,
      };
    }));
  return new ActionRowBuilder().addComponents(menu);
}

function convertButtonRow(type, ownerId, enabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`chestx:convert:${ownerId}:${type}`)
      .setLabel('♻️ Convert')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!enabled),
  );
}

/**
 * Return the largest complete source quantity currently affordable. Any
 * remainder stays in the bag and is never silently consumed.
 */
function maxConvertibleSource(defOrType, bag) {
  const def = typeof defOrType === 'string' ? definitionFor(defOrType) : defOrType;
  if (!def) return 0;
  return Math.floor(integerBalance(bag?.[def.sourceColumn]) / def.rate) * def.rate;
}

function maxConvertibleOutput(defOrType, bag) {
  const def = typeof defOrType === 'string' ? definitionFor(defOrType) : defOrType;
  if (!def) return 0;
  return maxConvertibleSource(def, bag) / def.rate;
}

/**
 * Parse only positive, decimal-free, safe integers. Divisibility is checked
 * separately so callers can provide the rate-specific error message.
 */
function parseSourceAmount(raw) {
  const value = String(raw ?? '').trim();
  if (!/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function isCompleteConversion(amount, defOrType) {
  const def = typeof defOrType === 'string' ? definitionFor(defOrType) : defOrType;
  return Boolean(def)
    && Number.isSafeInteger(amount)
    && amount > 0
    && amount % def.rate === 0;
}

function insufficientLine(def, amount, bag, maxSource) {
  const have = integerBalance(bag?.[def.sourceColumn]);
  const maximum = maxSource ?? maxConvertibleSource(def, bag);
  return `You cannot convert **${amount.toLocaleString()}** ${def.sourceName}s.\n\n`
    + `You have **${have.toLocaleString()}** ${def.sourceName}s.\n`
    + `Maximum convertible: **${maximum.toLocaleString()}** ${def.sourceName}s.\n`
    + `You need at least **${def.rate}** ${def.sourceName}s to receive 1 ${def.destinationName}.`;
}

/**
 * Build the continuous conversion view. The current balance and maximum are
 * informational here; convertBulk re-reads and locks the row at confirmation.
 */
function buildPayload(bag, type, ownerId, { resultLine = null, color = null } = {}) {
  const def = definitionFor(type) || CHEST_CONVERSIONS[DEFAULT_CONVERSION];
  const selectedType = definitionFor(type) ? type : DEFAULT_CONVERSION;
  const haveSource = integerBalance(bag?.[def.sourceColumn]);
  const haveDestination = integerBalance(bag?.[def.destinationColumn]);
  const maximumSource = maxConvertibleSource(def, bag);
  const maximumOutput = maximumSource / def.rate;

  const container = new ContainerBuilder()
    .setAccentColor(color ?? BRAND)
    .addTextDisplayComponents((td) => td.setContent(`## ${emoji(def.sourceEmoji)} Chest Conversion`));
  container.addTextDisplayComponents((td) => td.setContent(
    'Convert lower-tier or boss chests into higher-tier chests.'
  ));
  container.addActionRowComponents(() => conversionSelectRow(selectedType, ownerId));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    `**${def.sourceName} → ${def.destinationName}**\n`
      + `Requirement: **${def.rate}** ${emoji(def.sourceEmoji)} ${def.sourceName}s`
      + `  →  **1** ${emoji(def.destinationEmoji)} ${def.destinationName}`
  ));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    `-# You have ${emoji(def.sourceEmoji)} ${haveSource.toLocaleString()} · `
      + `Maximum convertible: ${maximumSource.toLocaleString()} · `
      + `Output: ${maximumOutput.toLocaleString()} ${emoji(def.destinationEmoji)} `
      + `· ${def.destinationName}: ${haveDestination.toLocaleString()}`
  ));
  if (resultLine) {
    container.addSeparatorComponents(sep);
    container.addTextDisplayComponents((td) => td.setContent(resultLine));
  }

  return {
    components: [container, convertButtonRow(selectedType, ownerId, maximumOutput >= 1)],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function execute(message, { args } = {}) {
  const ownerId = message.author.id;
  if (String(args?.[0] || '').toLowerCase() !== 'chest') {
    return message.reply({
      content: 'Use `crd convert chest` to convert chests.',
      allowedMentions: { repliedUser: false },
    });
  }
  const bag = await fetchBalances(ownerId);
  if (!bag) {
    return message.reply({
      content: 'You have no bag yet — `crd register` first.',
      allowedMentions: { repliedUser: false },
    });
  }
  return message.reply({ ...buildPayload(bag, DEFAULT_CONVERSION, ownerId), allowedMentions: { repliedUser: false } });
}

/** Select: chestx:type:<owner> — refresh the selected conversion. */
async function handleSelect(interaction) {
  const ownerId = interaction.customId.split(':')[2];
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Run `crd convert chest` yourself.', flags: MessageFlags.Ephemeral });
  }
  const type = definitionFor(interaction.values?.[0]) ? interaction.values[0] : DEFAULT_CONVERSION;
  await interaction.deferUpdate();
  try {
    const bag = await fetchBalances(ownerId);
    if (!bag) return interaction.followUp({ content: 'No bag found.', flags: MessageFlags.Ephemeral });
    return interaction.editReply(buildPayload(bag, type, ownerId));
  } catch (err) {
    console.error('[chestConvert] type select failed:', err.message);
    return interaction.followUp({
      content: 'Chest conversion view failed to refresh.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

function amountModal(ownerId, type) {
  const def = CHEST_CONVERSIONS[type];
  const amountInput = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('Source Chest Quantity')
    .setPlaceholder(`Enter a multiple of ${def.rate}`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`chestx:amount:${ownerId}:${type}:${randomUUID()}`)
    .setTitle('Convert Chests')
    .addComponents(new ActionRowBuilder().addComponents(amountInput));
}

/** Button: chestx:convert:<owner>:<type> — open the source-quantity modal. */
async function handleConvert(interaction, ownerId, type) {
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'This chest conversion is not yours.', flags: MessageFlags.Ephemeral });
  }
  if (!definitionFor(type)) type = DEFAULT_CONVERSION;
  return interaction.showModal(amountModal(ownerId, type));
}

async function rollback(client) {
  await client.query('ROLLBACK').catch(() => {});
}

/**
 * Execute one conversion atomically. The existing submission table makes the
 * modal UUID durable, so a Discord retry can never grant the same conversion
 * twice, even after the original transaction has committed.
 */
async function convertBulk(client, discordId, type, sourceAmount, submissionId) {
  const def = definitionFor(type);
  if (!def) throw new Error('unknown chest conversion');
  if (!Number.isSafeInteger(sourceAmount) || sourceAmount <= 0) throw new Error('invalid source quantity');
  if (!isCompleteConversion(sourceAmount, def)) throw new Error('source quantity is not a complete conversion');
  if (!UUID_PATTERN.test(String(submissionId || ''))) throw new Error('invalid conversion submission');

  await client.query('BEGIN');
  try {
    const claim = await client.query(
      `INSERT INTO essence_exchange_submissions (submission_id, discord_id)
       VALUES ($1, $2)
       ON CONFLICT (submission_id) DO NOTHING
       RETURNING submission_id`,
      [submissionId, discordId],
    );
    if (claim.rows.length === 0) {
      await rollback(client);
      return { status: 'duplicate' };
    }

    const bagRes = await client.query(
      `SELECT ${BALANCE_SELECT}
         FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
      [discordId],
    );
    if (bagRes.rows.length === 0) {
      await rollback(client);
      return { status: 'notfound' };
    }

    const bag = bagRes.rows[0];
    const maximumSource = maxConvertibleSource(def, bag);
    if (sourceAmount > maximumSource) {
      await rollback(client);
      return { status: 'insufficient', bag, maximumSource };
    }

    const outputAmount = sourceAmount / def.rate;
    const update = await client.query(
      `UPDATE users_bag
          SET ${def.sourceColumn} = ${def.sourceColumn} - $2,
              ${def.destinationColumn} = ${def.destinationColumn} + $3
        WHERE discord_id = $1 AND ${def.sourceColumn} >= $2`,
      [discordId, sourceAmount, outputAmount],
    );
    if (update.rowCount !== 1) {
      await rollback(client);
      return { status: 'insufficient', bag, maximumSource };
    }

    const previousDestination = integerBalance(bag[def.destinationColumn]);
    const updatedDestination = previousDestination + outputAmount;
    await client.query(
      `INSERT INTO game_logs
        (discord_id, action, item_type, previous_chest_count, updated_chest_count)
       VALUES ($1, 'Chest Conversion', $2, $3, $4)`,
      [discordId, def.destinationColumn, previousDestination, updatedDestination],
    );
    const updatedRes = await client.query(
      `SELECT ${BALANCE_SELECT} FROM users_bag WHERE discord_id = $1`,
      [discordId],
    );
    if (updatedRes.rows.length === 0) throw new Error('updated bag disappeared during chest conversion');

    await client.query('COMMIT');
    return {
      status: 'done',
      sourceAmount,
      outputAmount,
      bag: updatedRes.rows[0],
    };
  } catch (err) {
    await rollback(client);
    throw err;
  }
}

/** Modal: chestx:amount:<owner>:<type>:<submission> — confirm one conversion. */
async function handleModalSubmit(interaction, ownerId, type, submissionId) {
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'This chest conversion is not yours.', flags: MessageFlags.Ephemeral });
  }
  if (!definitionFor(type) || !UUID_PATTERN.test(String(submissionId || ''))) {
    return interaction.reply({
      content: 'This conversion form is no longer valid. Run `crd convert chest` again.',
      flags: MessageFlags.Ephemeral,
    });
  }

  let rawAmount;
  try {
    rawAmount = interaction.fields.getTextInputValue('amount');
  } catch {
    return interaction.reply({ content: 'Enter the number of source chests.', flags: MessageFlags.Ephemeral });
  }

  const amount = parseSourceAmount(rawAmount);
  const def = CHEST_CONVERSIONS[type];
  if (amount === null) {
    return interaction.reply({
      content: 'Enter a positive whole-number source quantity within the safe integer limit. Decimals, negatives, and other text are not accepted.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!isCompleteConversion(amount, def)) {
    return interaction.reply({
      content: `${def.sourceName}s must be converted in multiples of ${def.rate}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let client;
  let result;
  try {
    client = await pool.connect();
    result = await convertBulk(client, ownerId, type, amount, submissionId);
  } catch (err) {
    if (client) await rollback(client);
    console.error('[chestConvert] conversion failed:', err.message);
    return interaction.editReply({ content: 'Chest conversion failed — nothing was spent.' }).catch(() => {});
  } finally {
    if (client) client.release();
  }

  if (result.status === 'duplicate') {
    return interaction.editReply({ content: 'This conversion form was already processed. No additional chests were granted.' });
  }
  if (result.status === 'notfound') {
    return interaction.editReply({ content: 'You have no bag yet — `crd register` first.' });
  }
  if (result.status === 'insufficient') {
    return interaction.editReply({ content: insufficientLine(def, amount, result.bag, result.maximumSource) });
  }

  const bag = result.bag;
  const remainingSource = integerBalance(bag[def.sourceColumn]);
  const destinationBalance = integerBalance(bag[def.destinationColumn]);
  await interaction.editReply({
    content: 'Chest Conversion Complete\n\n'
      + `${result.sourceAmount.toLocaleString()} ${emoji(def.sourceEmoji)} ${def.sourceName}s\n`
      + `→\n`
      + `${result.outputAmount.toLocaleString()} ${emoji(def.destinationEmoji)} ${def.destinationName}s\n\n`
      + `Remaining ${def.sourceName}s: ${remainingSource.toLocaleString()}\n`
      + `${def.destinationName}s: ${destinationBalance.toLocaleString()}`,
  });

  if (interaction.message) {
    await interaction.message.edit(buildPayload(bag, type, ownerId, {
      resultLine: `✅ Converted **${result.sourceAmount.toLocaleString()}× ${def.sourceName}s** ${emoji(def.sourceEmoji)} → **${result.outputAmount.toLocaleString()}× ${def.destinationName}s** ${emoji(def.destinationEmoji)}`,
      color: GREEN,
    })).catch((err) => console.warn('[chestConvert] view refresh failed:', err.message));
  }
}

module.exports = {
  execute,
  handleSelect,
  handleConvert,
  handleModalSubmit,
  buildPayload,
  conversionDefinitions: CHEST_CONVERSIONS,
  CHEST_CONVERSIONS,
  CONVERSION_TYPES,
  parseSourceAmount,
  isCompleteConversion,
  maxConvertibleSource,
  maxConvertibleOutput,
  convertBulk,
  CHEST_BALANCE_COLUMNS,
  BRAND,
  GREEN,
};
