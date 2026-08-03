'use strict';

const pool = require('../db/pool');
const { generateUniqueTicketId } = require('../utils/weaponId');
const { requestChannelLabel } = require('../config/customRequests');

const TICKET_TYPES = Object.freeze(new Set(['avatar', 'deity']));

function buildTokenRedemptionReply(message, item, ticketId) {
  const noun = item?.type === 'deity' ? 'deity' : 'avatar';
  const mark = String.fromCharCode(96);
  return '✅ Redeemed **' + item.name + '**. Ticket: ' + mark + ticketId + mark + '\n\n' +
    'Post your request in ' + requestChannelLabel(message) + ' and include your ticket number. ' +
    'Describe the ' + noun + ' you want and attach any reference images.';
}

function assertTicketItem(item) {
  if (!item || item.use !== 'ticket' || !TICKET_TYPES.has(item.type)) {
    throw new Error('Unsupported custom-content ticket item');
  }
  if (!['custom_avatar_token', 'custom_deity_token'].includes(item.column)) {
    throw new Error('Unsupported custom-content token column');
  }
}

/** Consume one token and create its ticket on the caller's open transaction. */
async function redeemTokenTx(client, userId, item) {
  assertTicketItem(item);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ticketId = await generateUniqueTicketId(client);
    await client.query('SAVEPOINT ticket_id_attempt');
    try {
      const result = await client.query(
        `WITH consumed AS (
           UPDATE users_bag
              SET ${item.column} = ${item.column} - 1
            WHERE discord_id = $1 AND ${item.column} >= 1
            RETURNING discord_id
         ), inserted AS (
           INSERT INTO tickets (ticket_id, type, user_id)
           SELECT $2, $3, discord_id FROM consumed
           RETURNING ticket_id
         )
         SELECT
           (SELECT count(*)::int FROM consumed) AS consumed,
           (SELECT ticket_id FROM inserted LIMIT 1) AS ticket_id`,
        [userId, ticketId, item.type]
      );
      const row = result.rows[0] || {};
      const consumed = Number(row.consumed) === 1;
      if (row.ticket_id) {
        await client.query('RELEASE SAVEPOINT ticket_id_attempt');
        return { status: 'created', ticketId: row.ticket_id };
      }
      await client.query('ROLLBACK TO SAVEPOINT ticket_id_attempt');
      await client.query('RELEASE SAVEPOINT ticket_id_attempt');
      if (!consumed) return { status: 'insufficient' };
      // A concurrent ticket-id collision consumed no token after the savepoint rollback;
      // generate another id and retry inside the same outer transaction.
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT ticket_id_attempt').catch(() => {});
      await client.query('RELEASE SAVEPOINT ticket_id_attempt').catch(() => {});
      if (err.code === '23505') continue;
      throw err;
    }
  }
  throw new Error('Could not allocate a unique ticket id after 10 attempts');
}

/** Public redemption wrapper: decrement and ticket insert share one transaction. */
async function redeemToken(userId, item) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await redeemTokenTx(client, userId, item);
    if (result.status !== 'created') {
      await client.query('ROLLBACK');
      return result;
    }
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { redeemTokenTx, redeemToken, buildTokenRedemptionReply };
