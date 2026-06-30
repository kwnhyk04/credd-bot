'use strict';

const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const { logCasino } = require('./betGuard');

const ACTIVE_STATUSES = ['active', 'resolving'];

function mergeMetadata(base, patch) {
  return { ...(base || {}), ...(patch || {}) };
}

function terminalAfter(row) {
  return Number(row.balance_after ?? row.balance_after_debit);
}

function isExpired(row) {
  if (typeof row.is_expired === 'boolean') return row.is_expired;
  const expiresAt = row.expires_at instanceof Date
    ? row.expires_at.getTime()
    : new Date(row.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

async function refundExpiredTx(client, row, reason) {
  if (!ACTIVE_STATUSES.includes(row.status)) {
    return { status: row.status, after: terminalAfter(row), refunded: false };
  }
  if (!isExpired(row)) {
    return { status: row.status, after: terminalAfter(row), refunded: false };
  }

  const credit = await client.query(
    'UPDATE users_bag SET credux = credux + $2 WHERE discord_id = $1 RETURNING credux',
    [row.discord_id, Number(row.bet_amount)]
  );
  if (credit.rows.length === 0) {
    const metadata = mergeMetadata(row.metadata, {
      recovery_reason: reason,
      recovery_error: 'users_bag row missing during stale casino refund',
      recovered_at: new Date().toISOString(),
    });
    await client.query(
      `UPDATE active_casino_sessions
          SET status = 'expired',
              metadata = $2::jsonb,
              updated_at = NOW()
        WHERE session_id = $1`,
      [row.session_id, JSON.stringify(metadata)]
    );
    return { status: 'expired', after: terminalAfter(row), refunded: false };
  }

  const after = Number(credit.rows[0].credux);
  const metadata = mergeMetadata(row.metadata, {
    recovery_reason: reason,
    recovered_at: new Date().toISOString(),
    refunded_amount: Number(row.bet_amount),
  });
  await client.query(
    `UPDATE active_casino_sessions
        SET status = 'refunded',
            payout = $2,
            balance_after = $3,
            metadata = $4::jsonb,
            updated_at = NOW()
      WHERE session_id = $1`,
    [row.session_id, Number(row.bet_amount), after, JSON.stringify(metadata)]
  );
  return { status: 'refunded', after, refunded: true };
}

async function recoverExpiredForUserGame(discordId, game, reason = 'start_recovery') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT *
         FROM active_casino_sessions
        WHERE discord_id = $1
          AND game = $2
          AND status IN ('active', 'resolving')
          AND expires_at <= NOW()
        ORDER BY created_at
        FOR UPDATE`,
      [discordId, game]
    );
    const recovered = [];
    for (const row of rows) {
      recovered.push(await refundExpiredTx(client, row, reason));
    }
    await client.query('COMMIT');
    return recovered;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function recoverExpiredSession(sessionId, reason = 'button_recovery') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT *
         FROM active_casino_sessions
        WHERE session_id = $1
        FOR UPDATE`,
      [sessionId]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 'missing', refunded: false };
    }
    const result = await refundExpiredTx(client, rows[0], reason);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function recoverExpiredSessions({ limit = 50, reason = 'sweep_recovery' } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT *
         FROM active_casino_sessions
        WHERE status IN ('active', 'resolving')
          AND expires_at <= NOW()
        ORDER BY expires_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    const recovered = [];
    for (const row of rows) {
      recovered.push(await refundExpiredTx(client, row, reason));
    }
    await client.query('COMMIT');
    return recovered;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function beginStatefulSession({
  discordId,
  game,
  bet,
  channelId = null,
  staleMs,
  state = {},
  metadata = {},
}) {
  const sessionId = randomUUID();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT *, expires_at <= NOW() AS is_expired
         FROM active_casino_sessions
        WHERE discord_id = $1
          AND game = $2
          AND status IN ('active', 'resolving')
        ORDER BY created_at
        FOR UPDATE`,
      [discordId, game]
    );

    for (const row of existing.rows) {
      if (!row.is_expired) {
        await client.query('ROLLBACK');
        return { status: 'active' };
      }
      await refundExpiredTx(client, row, 'start_recovery');
    }

    const bag = await client.query(
      'SELECT credux FROM users_bag WHERE discord_id = $1 FOR UPDATE',
      [discordId]
    );
    if (bag.rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 'missing' };
    }
    const before = Number(bag.rows[0].credux);
    if (before < bet) {
      await client.query('ROLLBACK');
      return { status: 'insufficient', balance: before };
    }
    const afterDebit = before - bet;

    await client.query(
      `INSERT INTO active_casino_sessions
         (session_id, discord_id, game, status, bet_amount, balance_before,
          balance_after_debit, channel_id, state_json, metadata, expires_at)
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8::jsonb, $9::jsonb,
          NOW() + ($10::int * INTERVAL '1 millisecond'))`,
      [
        sessionId,
        discordId,
        game,
        bet,
        before,
        afterDebit,
        channelId,
        JSON.stringify(state || {}),
        JSON.stringify(metadata || {}),
        staleMs,
      ]
    );

    const debit = await client.query(
      'UPDATE users_bag SET credux = credux - $2 WHERE discord_id = $1 AND credux >= $2 RETURNING credux',
      [discordId, bet]
    );
    if (debit.rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 'insufficient', balance: before };
    }

    await client.query('COMMIT');
    return { status: 'ok', sessionId, before, after: Number(debit.rows[0].credux) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err && err.code === '23505') return { status: 'active' };
    throw err;
  } finally {
    client.release();
  }
}

async function attachMessage(sessionId, { channelId, messageId }) {
  await pool.query(
    `UPDATE active_casino_sessions
        SET channel_id = COALESCE($2, channel_id),
            message_id = $3,
            updated_at = NOW()
      WHERE session_id = $1
        AND status IN ('active', 'resolving')`,
    [sessionId, channelId || null, messageId]
  );
}

async function ensurePlayableSession({ sessionId, discordId, game }) {
  const { rows } = await pool.query(
    `SELECT status, expires_at <= NOW() AS is_expired
       FROM active_casino_sessions
      WHERE session_id = $1
        AND discord_id = $2
        AND game = $3`,
    [sessionId, discordId, game]
  );
  if (rows.length === 0) return { ok: false, status: 'missing' };
  const row = rows[0];
  if (!ACTIVE_STATUSES.includes(row.status)) return { ok: false, status: row.status };
  if (row.is_expired) return { ok: false, status: 'expired' };
  return { ok: true };
}

async function settleStatefulSession({ sessionId, discordId, game, payout, metadata }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT *
         FROM active_casino_sessions
        WHERE session_id = $1
          AND discord_id = $2
          AND game = $3
        FOR UPDATE`,
      [sessionId, discordId, game]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 'missing' };
    }
    const row = rows[0];
    if (!ACTIVE_STATUSES.includes(row.status)) {
      await client.query('ROLLBACK');
      return { status: row.status, after: terminalAfter(row) };
    }
    if (isExpired(row)) {
      const refunded = await refundExpiredTx(client, row, 'settlement_found_expired');
      await client.query('COMMIT');
      return refunded;
    }

    await client.query(
      `UPDATE active_casino_sessions
          SET status = 'resolving',
              updated_at = NOW()
        WHERE session_id = $1`,
      [sessionId]
    );

    let after;
    if (payout > 0) {
      const upd = await client.query(
        'UPDATE users_bag SET credux = credux + $2 WHERE discord_id = $1 RETURNING credux',
        [discordId, payout]
      );
      after = upd.rows.length ? Number(upd.rows[0].credux) : Number(row.balance_before) - Number(row.bet_amount) + payout;
    } else {
      const sel = await client.query('SELECT credux FROM users_bag WHERE discord_id = $1', [discordId]);
      after = sel.rows.length ? Number(sel.rows[0].credux) : Number(row.balance_before) - Number(row.bet_amount);
    }

    const nextMetadata = mergeMetadata(row.metadata, metadata);
    await logCasino(client, {
      discordId,
      game,
      bet: Number(row.bet_amount),
      payout,
      before: Number(row.balance_before),
      after,
      metadata: nextMetadata,
    });
    await client.query(
      `UPDATE active_casino_sessions
          SET status = 'settled',
              payout = $2,
              balance_after = $3,
              metadata = $4::jsonb,
              updated_at = NOW()
        WHERE session_id = $1`,
      [sessionId, payout, after, JSON.stringify(nextMetadata)]
    );
    await client.query('COMMIT');
    return { status: 'settled', after };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  beginStatefulSession,
  attachMessage,
  ensurePlayableSession,
  settleStatefulSession,
  recoverExpiredForUserGame,
  recoverExpiredSession,
  recoverExpiredSessions,
};
