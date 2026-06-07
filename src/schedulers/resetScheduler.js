'use strict';

const cron = require('node-cron');
const pool = require('../db/pool');

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
  // 0 16 * * * = 16:00 UTC = 00:00 PHT
  cron.schedule('0 16 * * *', async () => {
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
  }, {
    timezone: 'Asia/Manila',
    scheduled: true,
  });

  console.log('[resetScheduler] Midnight PHT reset scheduler started.');
}

module.exports = { startResetScheduler };
