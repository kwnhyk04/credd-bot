'use strict';

/**
 * exchange.js — `crd exchange <id>` (Phase 2 §2.7).
 *
 * One-way essence-shop purchase (never downward). Each id (1-6, ESSENCE_SHOP)
 * spends `cost.amount` of an essence tier + `cost.credux` Credux, granting +1 of
 * a rune bag or a higher essence tier. Atomic: lock users_bag, validate, deduct,
 * grant, COMMIT; game_logs audit row best-effort after commit.
 */

const pool = require('../../db/pool');
const { emoji } = require('../../utils/emojis');
const { ESSENCE_SHOP, ESSENCE_COLUMN } = require('../../config/runes');

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

async function execute(message, { args }) {
  const id = parseInt(args[0], 10);
  const item = ESSENCE_SHOP.find((i) => i.id === id);
  if (!item) {
    return reply(message, 'Usage: `crd exchange <id>` — see `crd essence shop` for ids (1-6).');
  }
  const essCol = ESSENCE_COLUMN[item.cost.essence];   // whitelisted from constant map
  const grantCol = item.grant.column;                 // whitelisted from constant map
  const discordId = message.author.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bagRes = await client.query(
      `SELECT credux, ${essCol} AS ess FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
      [discordId]
    );
    if (bagRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'You have no bag yet — `crd register` first.');
    }
    const { credux, ess } = bagRes.rows[0];
    if (ess < item.cost.amount) {
      await client.query('ROLLBACK');
      return reply(message, `Not enough ${item.cost.essence} essence — need ${item.cost.amount}, have ${ess}.`);
    }
    if (Number(credux) < item.cost.credux) {
      await client.query('ROLLBACK');
      return reply(message, `Not enough Credux — need ${item.cost.credux.toLocaleString()}, have ${Number(credux).toLocaleString()}.`);
    }

    const upd = await client.query(
      `UPDATE users_bag
          SET ${essCol} = ${essCol} - $2,
              credux    = credux - $3,
              ${grantCol} = ${grantCol} + $4
        WHERE discord_id = $1
      RETURNING ${grantCol} AS granted, ${essCol} AS ess_left, credux AS credux_left`,
      [discordId, item.cost.amount, item.cost.credux, item.grant.amount]
    );
    await client.query('COMMIT');

    pool.query(
      `INSERT INTO game_logs (discord_id, action, item_type) VALUES ($1, 'Exchange', $2)`,
      [discordId, grantCol]
    ).catch(() => {});

    return reply(message, `✅ Bought **${item.grant.amount}× ${item.name}** ${emoji(item.emojiName)}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[exchange]', err.message);
    return reply(message, 'Exchange failed — nothing was spent.');
  } finally {
    client.release();
  }
}

module.exports = { execute };
