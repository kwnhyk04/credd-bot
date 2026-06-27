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
const { ESSENCE_SHOP, ESSENCE_COLUMN, EXCHANGE_IDS } = require('../../config/runes');
const exchangeEssence = require('./exchangeEssence');

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/**
 * `crd exchange <id|lb|gb|db> [qty]` — buy rune bags (Phase 6: letter ids + quantity).
 * `crd exchange essence` routes to the continuous essence tier-up flow (exchangeEssence).
 * One-way only. qty defaults to 1; the whole order is validated then applied atomically.
 */
async function execute(message, { args }) {
  const first = (args[0] || '').toLowerCase();
  if (first === 'essence') {
    return exchangeEssence.execute(message, { args: args.slice(1) });
  }

  // Letter alias (lb/gb/db) or numeric id.
  const id = EXCHANGE_IDS[first] ?? parseInt(first, 10);
  const item = ESSENCE_SHOP.find((i) => i.id === id);
  if (!item) {
    return reply(message, 'Usage: `crd exchange <lb|gb|db|1|2|3> [qty]` — see `crd essence shop`. For essence tiers: `crd exchange essence`.');
  }

  const qty = Math.max(1, parseInt(args[1], 10) || 1);
  const essCol = ESSENCE_COLUMN[item.cost.essence];   // whitelisted from constant map
  const grantCol = item.grant.column;                 // whitelisted from constant map
  const needEss = item.cost.amount * qty;
  const needCredux = item.cost.credux * qty;
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
    // Max affordable across both constraints — surfaced when the order is short.
    const maxAfford = Math.min(
      Math.floor(Number(ess) / item.cost.amount),
      Math.floor(Number(credux) / item.cost.credux)
    );
    if (Number(ess) < needEss) {
      await client.query('ROLLBACK');
      return reply(message, `Not enough ${item.cost.essence} essence for ${qty}× — need ${needEss}, have ${ess}. You can afford **${Math.max(0, maxAfford)}**.`);
    }
    if (Number(credux) < needCredux) {
      await client.query('ROLLBACK');
      return reply(message, `Not enough Credux for ${qty}× — need ${needCredux.toLocaleString()}, have ${Number(credux).toLocaleString()}. You can afford **${Math.max(0, maxAfford)}**.`);
    }

    await client.query(
      `UPDATE users_bag
          SET ${essCol} = ${essCol} - $2,
              credux    = credux - $3,
              ${grantCol} = ${grantCol} + $4
        WHERE discord_id = $1`,
      [discordId, needEss, needCredux, item.grant.amount * qty]
    );
    await client.query('COMMIT');

    pool.query(
      `INSERT INTO game_logs (discord_id, action, item_type) VALUES ($1, 'Exchange', $2)`,
      [discordId, grantCol]
    ).catch(() => {});

    return reply(message, `✅ Bought **${item.grant.amount * qty}× ${item.name}** ${emoji(item.emojiName)}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[exchange]', err.message);
    return reply(message, 'Exchange failed — nothing was spent.');
  } finally {
    client.release();
  }
}

module.exports = { execute };
