'use strict';

const cron = require('node-cron');
const pool = require('../db/pool');
const { rollQuestsIfMissing } = require('../utils/questProgress');

/**
 * Midnight PHT (UTC+8) = 16:00 UTC daily.
 * Resets:
 *   - users.monthly_streak / overall_streak (via last_daily_claim_date logic — no direct reset here;
 *     streak state is computed at claim time, so the reset is handled by the daily command itself)
 *   - users.bestow_received_today = 0, last_bestow_received = NULL (daily bestow cap)
 *   - user_character.reputation_exp_today = 0, reputation_exp_reset_date = today PHT
 *   - daily_quests rollover: delete old quests so next command re-rolls for new day
 *     (actual quest generation happens in the daily/quests command logic in Phase 8)
 */
function startResetScheduler() {
  // With timezone 'Asia/Manila', the cron expression is evaluated in PHT,
  // so '0 0 * * *' = 00:00 PHT (midnight). (NOT '0 16' — that would be 16:00 PHT.)
  const task = cron.schedule('0 0 * * *', async () => {
    console.log('[resetScheduler] Running midnight PHT reset...');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Reset bestow daily counters for all users whose last_bestow_received was today (PHT)
      await client.query(`
        UPDATE users
        SET bestow_received_today = 0
        WHERE last_bestow_received IS NOT NULL
      `);

      // Reset daily-quest refresh allowance (lazy stale-date check also covers this)
      await client.query(`
        UPDATE users
        SET quest_refreshes_today = 0
        WHERE quest_refreshes_today <> 0
      `);

      // Reset reputation EXP daily cap for all users
      await client.query(`
        UPDATE user_character
        SET reputation_exp_today = 0,
            reputation_exp_reset_date = (NOW() AT TIME ZONE 'Asia/Manila')::date
        WHERE reputation_exp_today > 0
           OR reputation_exp_reset_date < (NOW() AT TIME ZONE 'Asia/Manila')::date
      `);

      // Delete completed or stale daily_quests from previous days so they re-roll
      await client.query(`
        DELETE FROM daily_quests
        WHERE quest_date < (NOW() AT TIME ZONE 'Asia/Manila')::date
      `);

      await client.query('COMMIT');
      console.log('[resetScheduler] Midnight PHT reset complete.');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[resetScheduler] Reset failed:', err.message);
    } finally {
      client.release();
    }

    // Roll fresh daily quests for every player (per-user short transactions so one
    // failure can't roll back the rest; the lazy on-demand roll is the universal
    // backstop for anyone missed here, and ON CONFLICT makes the two paths idempotent).
    await rollDailyQuestsForAll();
  }, {
    timezone: 'Asia/Manila',
    scheduled: true,
  });

  console.log('[resetScheduler] Midnight PHT reset scheduler started.');
  return () => task.stop();
}

/**
 * Roll today's daily quests for every player with a character. Each user is rolled in
 * its own short transaction (rollQuestsIfMissing is no-op when quests already exist),
 * so a single failure never aborts the batch.
 */
async function rollDailyQuestsForAll() {
  let ids = [];
  try {
    const { rows } = await pool.query('SELECT discord_id FROM user_character');
    ids = rows.map((r) => r.discord_id);
  } catch (err) {
    console.error('[resetScheduler] quest-roll roster fetch failed:', err.message);
    return;
  }

  let rolled = 0;
  for (const discordId of ids) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const did = await rollQuestsIfMissing(client, discordId);
      await client.query('COMMIT');
      if (did) rolled += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[resetScheduler] quest roll failed for ${discordId}:`, err.message);
    } finally {
      client.release();
    }
  }
  console.log(`[resetScheduler] Daily quests rolled for ${rolled}/${ids.length} players.`);
}

module.exports = { startResetScheduler };
