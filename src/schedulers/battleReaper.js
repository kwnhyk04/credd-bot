'use strict';

const pool = require('../db/pool');

const STALE_BATTLE_MINUTES = 10;
const REAPER_INTERVAL_MS   = 60_000; // run every 1 minute

/**
 * Delete active_battles rows older than STALE_BATTLE_MINUTES.
 * The UNIQUE(discord_id) constraint means a stale row locks the player out of
 * new battles; removing it unlocks them automatically.
 */
async function reapStaleBattles() {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM active_battles
       WHERE started_at < NOW() - INTERVAL '${STALE_BATTLE_MINUTES} minutes'`
    );
    if (rowCount > 0) {
      console.log(`[battleReaper] Reaped ${rowCount} stale battle(s).`);
    }
  } catch (err) {
    console.error('[battleReaper] Reap error:', err.message);
  }
}

/**
 * On startup: delete ALL rows in active_battles (crashed/orphaned from previous run).
 * Then start the periodic reaper.
 */
async function startBattleReaper() {
  // Startup cleanup
  try {
    const { rowCount } = await pool.query('DELETE FROM active_battles');
    if (rowCount > 0) {
      console.log(`[battleReaper] Startup cleanup: removed ${rowCount} stale battle(s).`);
    }
  } catch (err) {
    console.error('[battleReaper] Startup cleanup error:', err.message);
  }

  // Periodic reaper
  setInterval(reapStaleBattles, REAPER_INTERVAL_MS);
  console.log('[battleReaper] Periodic battle reaper started (every 1 min, threshold 10 min).');
}

module.exports = { startBattleReaper };
