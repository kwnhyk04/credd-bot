'use strict';

const pool = require('../db/pool');

const STALE_BATTLE_MINUTES = 5;
const REAPER_INTERVAL_MS   = 60_000; // run every 1 minute

/**
 * Delete active_battles rows older than STALE_BATTLE_MINUTES.
 * The UNIQUE(discord_id) constraint means a stale row locks the player out of
 * new battles; removing it unlocks them automatically.
 */
async function reapStaleBattles(reason = 'periodic') {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM active_battles
       WHERE started_at < NOW() - INTERVAL '${STALE_BATTLE_MINUTES} minutes'`
    );
    if (rowCount > 0) {
      console.log(`[battleReaper] ${reason}: reaped ${rowCount} stale battle(s).`);
    }
  } catch (err) {
    console.error(`[battleReaper] ${reason} reap error:`, err.message);
  }
}

/**
 * On startup: delete only stale active_battles rows.
 * Then start the periodic reaper.
 */
async function startBattleReaper() {
  await reapStaleBattles('startup cleanup');

  // Periodic reaper
  setInterval(reapStaleBattles, REAPER_INTERVAL_MS);
  console.log(`[battleReaper] Periodic battle reaper started (every 1 min, threshold ${STALE_BATTLE_MINUTES} min).`);
}

module.exports = { startBattleReaper };
