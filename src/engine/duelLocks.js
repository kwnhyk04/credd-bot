'use strict';

const { randomUUID } = require('crypto');
const pool = require('../db/pool');

const PENDING_DUEL_LOCK_MINUTES = 3;
const RUNNING_DUEL_LOCK_MINUTES = 10;

async function cleanupExpiredDuelLocks(db = pool) {
  await db.query('DELETE FROM active_duels WHERE expires_at <= NOW()');
}

async function acquireDuelLock({
  challengerId,
  opponentId,
  duelType,
  stake = null,
  guildId = null,
  channelId = null,
}) {
  const duelId = randomUUID();
  const lockToken = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await cleanupExpiredDuelLocks(client);
    await client.query(
      `INSERT INTO active_duels
         (duel_id, lock_token, challenger_id, opponent_id, duel_type, stake,
          status, guild_id, channel_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,
               NOW() + ($9::text || ' minutes')::interval)`,
      [
        duelId, lockToken, challengerId, opponentId, duelType, stake,
        guildId, channelId, PENDING_DUEL_LOCK_MINUTES,
      ]
    );
    const participants = await client.query(
      `INSERT INTO active_duel_participants
         (discord_id, duel_id, lock_token, role, expires_at)
       VALUES
         ($1,$3,$4,'challenger',NOW() + ($5::text || ' minutes')::interval),
         ($2,$3,$4,'opponent',NOW() + ($5::text || ' minutes')::interval)
       ON CONFLICT (discord_id) DO UPDATE SET
         duel_id = EXCLUDED.duel_id,
         lock_token = EXCLUDED.lock_token,
         role = EXCLUDED.role,
         expires_at = EXCLUDED.expires_at
       WHERE active_duel_participants.expires_at <= NOW()
       RETURNING discord_id`,
      [challengerId, opponentId, duelId, lockToken, PENDING_DUEL_LOCK_MINUTES]
    );
    if (participants.rowCount !== 2) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'busy' };
    }
    await client.query('COMMIT');
    return { ok: true, duelId, lockToken };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '42P01') return { ok: false, reason: 'missing_table' };
    throw err;
  } finally {
    client.release();
  }
}

async function attachDuelMessage(lock, messageId) {
  if (!lock?.duelId || !lock?.lockToken || !messageId) return;
  await pool.query(
    `UPDATE active_duels
        SET message_id = $3
      WHERE duel_id = $1 AND lock_token = $2`,
    [lock.duelId, lock.lockToken, messageId]
  );
}

async function markDuelRunning(lock) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT status, expires_at > NOW() AS fresh
         FROM active_duels
        WHERE duel_id = $1 AND lock_token = $2
        FOR UPDATE`,
      [lock.duelId, lock.lockToken]
    );
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'missing' };
    }
    const row = cur.rows[0];
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_pending' };
    }
    if (!row.fresh) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'expired' };
    }
    await client.query(
      `UPDATE active_duels
          SET status = 'running',
              accepted_at = NOW(),
              expires_at = NOW() + ($3::text || ' minutes')::interval
        WHERE duel_id = $1 AND lock_token = $2`,
      [lock.duelId, lock.lockToken, RUNNING_DUEL_LOCK_MINUTES]
    );
    await client.query(
      `UPDATE active_duel_participants
          SET expires_at = NOW() + ($3::text || ' minutes')::interval
        WHERE duel_id = $1 AND lock_token = $2`,
      [lock.duelId, lock.lockToken, RUNNING_DUEL_LOCK_MINUTES]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '42P01') return { ok: false, reason: 'missing_table' };
    throw err;
  } finally {
    client.release();
  }
}

async function markDuelSettling(lock) {
  await pool.query(
    `UPDATE active_duels
        SET status = 'settling'
      WHERE duel_id = $1 AND lock_token = $2 AND status = 'running'`,
    [lock.duelId, lock.lockToken]
  );
}

async function releaseDuelLock(lock) {
  if (!lock?.duelId || !lock?.lockToken) return;
  await pool.query(
    'DELETE FROM active_duels WHERE duel_id = $1 AND lock_token = $2',
    [lock.duelId, lock.lockToken]
  );
}

module.exports = {
  PENDING_DUEL_LOCK_MINUTES,
  RUNNING_DUEL_LOCK_MINUTES,
  acquireDuelLock,
  attachDuelMessage,
  cleanupExpiredDuelLocks,
  markDuelRunning,
  markDuelSettling,
  releaseDuelLock,
};
