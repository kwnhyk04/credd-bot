'use strict';

/**
 * `crd bestow @user <amount>` — gift Credux to another player (Master §3, Phase 8).
 *
 * Flow: validate → Components V2 confirm card (sender-only, 60s collector) → on
 * Confirm an atomic transfer in one transaction with IN-TRANSACTION re-validation
 * (balance + receiver daily cap re-checked under row locks, since state may have
 * moved since the card was shown). No balances are ever displayed (§3).
 *
 * Receiver daily cap: base 1,000,000 Credux/day + 500,000 per receiver Believer Level
 * + 500,000 per receiver Combat Level (see src/config/bestow.js). PHT clock via
 * users.last_bestow_received + bestow_received_today; a stale date means today's received
 * is 0. Partial fills are NOT allowed — if the amount would exceed the receiver's remaining
 * headroom the bestow is rejected and the remaining headroom is stated.
 *
 * Lock order (Phase-5 convention): both users_bag rows (sorted discord_id) FOR UPDATE,
 * then the receiver's users row FOR UPDATE for the cap counters.
 */

const {
  ContainerBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { isBanned } = require('../../handlers/middleware');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emoji } = require('../../utils/emojis');
const { registerMemorySource } = require('../../utils/memoryRegistry');
const { computeBestowDailyCap } = require('../../config/bestow');

const CONFIRM_WINDOW_MS = 60_000;

/** Next PHT (Asia/Manila, UTC+8, no DST) midnight as a unix timestamp (seconds). */
function nextPhtResetUnix() {
  const nowMs = Date.now();
  const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
  // Midnight PHT is 16:00 UTC the previous day. Find the next such instant strictly ahead.
  const phtNow = new Date(nowMs + PHT_OFFSET_MS);
  const nextPhtMidnightUtcMs = Date.UTC(
    phtNow.getUTCFullYear(), phtNow.getUTCMonth(), phtNow.getUTCDate() + 1
  ) - PHT_OFFSET_MS;
  return Math.floor(nextPhtMidnightUtcMs / 1000);
}

/** Cap-exceeded body: requested, limit, remaining, levels, next reset. */
function capExceededBody(receiverId, amount, limit, headroom, believerLevel, combatLevel) {
  return [
    `That exceeds <@${receiverId}>'s daily bestow cap.`,
    `• Requested: **${amount.toLocaleString()}**`,
    `• Daily limit: **${limit.toLocaleString()}**`,
    `• Remaining today: **${Math.max(0, headroom).toLocaleString()}**`,
    `• Believer Level: **${believerLevel}** · Combat Level: **${combatLevel}**`,
    `• Resets <t:${nextPhtResetUnix()}:F>`,
  ].join('\n');
}
let activeBestowCollectors = 0;

const GOLD = 0xf0b232;
const GREEN = 0x43d675;
const GREY = 0x95a5a6;
const RED = 0xf23f43;

const RMT_WARNING =
  '⚠️ **Bestowing Credux in exchange for real money, gift cards, or anything of ' +
  'real-world value is strictly prohibited.** Real-money trading (RMT) in any form ' +
  'will result in a permanent ban for all accounts involved.';

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/** The myth-flavored bestow line with the amount + an exact Discord timestamp. */
function bestowLine(senderMention, receiverMention, amount, unixSeconds) {
  // [v4.8] credux icon before the amount (icon-before-amount convention).
  return `✨ By the will of the gods, ${senderMention} bestows ` +
    `${emoji('credux_coin')} **${amount.toLocaleString()} Credux** upon ${receiverMention}. Sealed <t:${unixSeconds}:F>.`;
}

/** Confirm card (CV2): header → sep → myth line → sep → RMT warning (+ buttons). */
function buildConfirmPayload(senderMention, receiverMention, amount, unixSeconds) {
  const container = new ContainerBuilder()
    .setAccentColor(GOLD)
    .addTextDisplayComponents((td) => td.setContent(`## ⚜️ Bestow`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(bestowLine(senderMention, receiverMention, amount, unixSeconds)))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(RMT_WARNING));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bestow_confirm').setLabel('Confirm').setEmoji('⚜️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('bestow_cancel').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );
  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

/** Terminal card (CV2): a single-line outcome container, buttons dropped. */
function buildResultPayload(headerLine, body, color) {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents((td) => td.setContent(headerLine));
  if (body) container.addSeparatorComponents(sep).addTextDisplayComponents((td) => td.setContent(body));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Atomic transfer with in-transaction re-validation. Returns a tagged result;
 * throws only on unexpected DB failure (→ ROLLBACK).
 */
async function performBestow(senderId, receiverId, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // both bag rows, sorted discord_id (deadlock-safe), locked
    const ids = [senderId, receiverId].sort();
    const bagRes = await client.query(
      'SELECT discord_id, credux FROM users_bag WHERE discord_id = ANY($1) ORDER BY discord_id FOR UPDATE',
      [ids]
    );
    if (bagRes.rows.length < 2) { await client.query('ROLLBACK'); return { status: 'missing' }; }
    const byId = Object.fromEntries(bagRes.rows.map((r) => [r.discord_id, r]));
    const senderBag = byId[senderId];
    const receiverBag = byId[receiverId];

    // receiver users row: cap counters + ban re-check (bag → users lock order).
    // LEFT JOIN user_character for the authoritative Believer/Combat levels that scale the cap.
    const uRes = await client.query(
      `SELECT u.is_banned, u.bestow_received_today,
              (u.last_bestow_received = (NOW() AT TIME ZONE 'Asia/Manila')::date) AS is_today,
              uc.believer_level, uc.combat_level
         FROM users u
         LEFT JOIN user_character uc ON uc.discord_id = u.discord_id
        WHERE u.discord_id = $1 FOR UPDATE OF u`,
      [receiverId]
    );
    if (uRes.rows.length === 0) { await client.query('ROLLBACK'); return { status: 'missing' }; }
    const u = uRes.rows[0];
    if (u.is_banned) { await client.query('ROLLBACK'); return { status: 'receiver_banned' }; }

    // stale date → today's received is 0
    const receivedToday = u.is_today ? Number(u.bestow_received_today) : 0;
    const believerLevel = u.believer_level == null ? 0 : Number(u.believer_level);
    const combatLevel = u.combat_level == null ? 0 : Number(u.combat_level);
    const limit = computeBestowDailyCap(believerLevel, combatLevel);
    const headroom = limit - receivedToday;
    if (amount > headroom) {
      await client.query('ROLLBACK');
      return { status: 'cap', headroom, limit, believerLevel, combatLevel };
    }
    if (Number(senderBag.credux) < amount) {
      await client.query('ROLLBACK');
      return { status: 'insufficient' };
    }

    const sBefore = Number(senderBag.credux);
    const rBefore = Number(receiverBag.credux);
    const sAfter = (await client.query(
      'UPDATE users_bag SET credux = credux - $2 WHERE discord_id = $1 RETURNING credux',
      [senderId, amount]
    )).rows[0].credux;
    const rAfter = (await client.query(
      'UPDATE users_bag SET credux = credux + $2 WHERE discord_id = $1 RETURNING credux',
      [receiverId, amount]
    )).rows[0].credux;

    await client.query(
      `UPDATE users SET bestow_received_today = $2,
                        last_bestow_received  = (NOW() AT TIME ZONE 'Asia/Manila')::date
        WHERE discord_id = $1`,
      [receiverId, receivedToday + amount]
    );

    // game_logs — sender (negative delta) then receiver (positive delta), action 'Bestow'
    await client.query(
      `INSERT INTO game_logs (discord_id, action, previous_credux, updated_credux)
       VALUES ($1, 'Bestow', $2, $3)`,
      [senderId, sBefore, Number(sAfter)]
    );
    await client.query(
      `INSERT INTO game_logs (discord_id, action, previous_credux, updated_credux)
       VALUES ($1, 'Bestow', $2, $3)`,
      [receiverId, rBefore, Number(rAfter)]
    );

    await client.query('COMMIT');
    return { status: 'ok' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function execute(message, { args }) {
  const sender = message.author;
  const receiver = message.getMention(0); // [v4.9] prefix @mention or slash user option

  if (!receiver) return reply(message, 'Usage: `crd bestow @user <amount>`');
  if (receiver.id === sender.id) return reply(message, 'You cannot bestow Credux to yourself.');
  if (receiver.bot) return reply(message, 'You cannot bestow Credux to a bot.');

  // amount: the first purely-numeric token (commas tolerated), positive integer
  const amountToken = args.map((a) => a.replace(/,/g, '')).find((a) => /^\d+$/.test(a));
  if (!amountToken) return reply(message, 'Enter a positive whole amount — e.g. `crd bestow @user 1000`.');
  const amount = Number(amountToken);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return reply(message, 'Enter a positive whole amount of Credux.');
  }

  try {
    // receiver must be registered + not banned (registration implies a users_bag row).
    // LEFT JOIN user_character for the levels that scale the receiver's daily cap.
    const recvRes = await pool.query(
      `SELECT u.is_banned, u.bestow_received_today,
              (u.last_bestow_received = (NOW() AT TIME ZONE 'Asia/Manila')::date) AS is_today,
              uc.believer_level, uc.combat_level
         FROM users u
         LEFT JOIN user_character uc ON uc.discord_id = u.discord_id
        WHERE u.discord_id = $1`,
      [receiver.id]
    );
    if (recvRes.rows.length === 0) {
      return reply(message, `<@${receiver.id}> is not registered yet.`);
    }
    if (recvRes.rows[0].is_banned || await isBanned(receiver.id)) {
      return reply(message, `<@${receiver.id}> cannot receive Credux right now.`);
    }

    // sender balance pre-check (re-validated in the transaction)
    const balRes = await pool.query('SELECT credux FROM users_bag WHERE discord_id = $1', [sender.id]);
    const balance = balRes.rows.length ? Number(balRes.rows[0].credux) : 0;
    if (balance < amount) {
      return reply(message, `You don't have enough Credux to bestow **${amount.toLocaleString()}**.`);
    }

    // receiver headroom pre-check (no partial fills); cap scales with receiver levels
    const recv = recvRes.rows[0];
    const receivedToday = recv.is_today ? Number(recv.bestow_received_today) : 0;
    const believerLevel = recv.believer_level == null ? 0 : Number(recv.believer_level);
    const combatLevel = recv.combat_level == null ? 0 : Number(recv.combat_level);
    const limit = computeBestowDailyCap(believerLevel, combatLevel);
    const headroom = limit - receivedToday;
    if (amount > headroom) {
      return reply(message,
        capExceededBody(receiver.id, amount, limit, headroom, believerLevel, combatLevel));
    }

    // confirm card — sender-only, 60s
    const offerUnix = Math.floor(Date.now() / 1000);
    const card = await message.reply({
      ...buildConfirmPayload(`<@${sender.id}>`, `<@${receiver.id}>`, amount, offerUnix),
      allowedMentions: { repliedUser: false, parse: [] },
    });

    const collector = card.createMessageComponentCollector({ time: CONFIRM_WINDOW_MS });
    activeBestowCollectors += 1;
    let settled = false;

    collector.on('collect', async (i) => {
      let transferred = false;
      try {
        if (i.user.id !== sender.id) {
          await i.reply({ content: 'Only the sender can confirm this bestow.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (settled) { await i.deferUpdate().catch(() => {}); return; }
        settled = true;
        collector.stop('settled');
        await i.deferUpdate();

        if (i.customId === 'bestow_cancel') {
          await i.editReply(buildResultPayload('✖️ Bestow cancelled. Nothing was transferred.', null, GREY));
          return;
        }

        const result = await performBestow(sender.id, receiver.id, amount);
        if (result.status === 'ok') {
          transferred = true;
          const sealedUnix = Math.floor(Date.now() / 1000);
          await i.editReply(buildResultPayload(
            `## ⚜️ Bestow`,
            bestowLine(`<@${sender.id}>`, `<@${receiver.id}>`, amount, sealedUnix),
            GREEN,
          ));
          return;
        }
        // re-validation failed inside the transaction — nothing written
        const msg = result.status === 'cap'
          ? `Bestow failed — cap reached.\n${capExceededBody(
              receiver.id, amount, Number(result.limit),
              Number(result.headroom), Number(result.believerLevel), Number(result.combatLevel),
            )}`
          : result.status === 'insufficient'
            ? 'Bestow failed — your balance changed and is no longer enough.'
            : result.status === 'receiver_banned'
              ? `<@${receiver.id}> can no longer receive Credux.`
              : 'Bestow failed — a participant is no longer available.';
        await i.editReply(buildResultPayload(`⚠️ ${msg}`, null, RED));
      } catch (err) {
        console.error('[bestow]', err);
        const message = transferred
          ? 'Bestow completed, but the confirmation message could not refresh.'
          : 'Something went wrong — no Credux was transferred.';
        await i.editReply(buildResultPayload(`⚠️ ${message}`, null, RED)).catch(() => {});
        await i.followUp({
          content: transferred
            ? 'Bestow completed, but the confirmation message could not refresh.'
            : 'Bestow failed — nothing was changed.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    });

    collector.on('end', (_c, reason) => {
      activeBestowCollectors = Math.max(0, activeBestowCollectors - 1);
      if (reason === 'settled') return;
      card.edit(buildResultPayload('⌛ Bestow offer expired. Nothing was transferred.', null, GREY)).catch(() => {});
    });
  } catch (err) {
    console.error('[bestow]', err);
    return reply(message, 'Bestow failed — nothing was changed.').catch(() => {});
  }
}

registerMemorySource('collectors.bestow', () => ({
  active: activeBestowCollectors,
  lifetimeMs: CONFIRM_WINDOW_MS,
}));

module.exports = { execute, performBestow };
