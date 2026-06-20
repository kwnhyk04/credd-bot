'use strict';

/**
 * supporterTokens.js — supporter-token economy (Supporter-stage spec §3).
 *
 * Tokens are the monthly cosmetic stipend. They are NEVER written to users_bag or
 * any credux column, and no function here reads credux — tokens and game currency
 * are fully isolated ledgers.
 *
 *   grantTokens(userId, amount, reason, ref)  — atomic ledger insert + balance bump
 *   spendTokens(userId, amount, reason, ref)  — SELECT FOR UPDATE, reject if short,
 *                                               negative ledger delta + decrement
 *   markStripeEventOnce(eventId, type)        — idempotency guard for webhook replays
 *
 * The `*Tx` variants take an existing pg client so the entitlement layer can fold a
 * grant into its own subscribe transaction. The public wrappers manage their own tx.
 */

const pool = require('../db/pool');

/** Insert a ledger row + bump token_balance, on an existing in-tx client. Returns new balance. */
async function grantTokensTx(client, userId, amount, reason, ref = null) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('grantTokens: amount must be a positive integer');
  await client.query(
    'INSERT INTO supporter_token_ledger (discord_id, delta, reason, ref) VALUES ($1,$2,$3,$4)',
    [userId, amount, reason, ref]
  );
  const upd = await client.query(
    'UPDATE supporters SET token_balance = token_balance + $2, updated_at = NOW() WHERE discord_id = $1 RETURNING token_balance',
    [userId, amount]
  );
  if (upd.rows.length === 0) throw new Error('grantTokens: no supporter row for ' + userId);
  return upd.rows[0].token_balance;
}

/**
 * Spend tokens on an existing in-tx client. Locks the supporter row, rejects if the
 * balance is short. Returns { ok, balance }. Never lets the balance go negative.
 */
async function spendTokensTx(client, userId, amount, reason, ref = null) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('spendTokens: amount must be a positive integer');
  const cur = await client.query(
    'SELECT token_balance FROM supporters WHERE discord_id = $1 FOR UPDATE',
    [userId]
  );
  if (cur.rows.length === 0) return { ok: false, reason: 'not_supporter', balance: 0 };
  const balance = cur.rows[0].token_balance;
  if (balance < amount) return { ok: false, reason: 'insufficient', balance };

  await client.query(
    'INSERT INTO supporter_token_ledger (discord_id, delta, reason, ref) VALUES ($1,$2,$3,$4)',
    [userId, -amount, reason, ref]
  );
  const upd = await client.query(
    'UPDATE supporters SET token_balance = token_balance - $2, updated_at = NOW() WHERE discord_id = $1 RETURNING token_balance',
    [userId, amount]
  );
  return { ok: true, balance: upd.rows[0].token_balance };
}

async function grantTokens(userId, amount, reason, ref = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const balance = await grantTokensTx(client, userId, amount, reason, ref);
    await client.query('COMMIT');
    return balance;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function spendTokens(userId, amount, reason, ref = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await spendTokensTx(client, userId, amount, reason, ref);
    if (res.ok) await client.query('COMMIT'); else await client.query('ROLLBACK');
    return res;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record a Stripe event id once (idempotency for webhook replays, §3). Returns true if this
 * call recorded it (first time → caller should process), false if already seen (skip).
 */
async function markStripeEventOnce(client, eventId, type) {
  const res = await client.query(
    'INSERT INTO stripe_events (event_id, type) VALUES ($1,$2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
    [eventId, type]
  );
  return res.rowCount > 0;
}

module.exports = {
  grantTokens, spendTokens, grantTokensTx, spendTokensTx, markStripeEventOnce,
};
