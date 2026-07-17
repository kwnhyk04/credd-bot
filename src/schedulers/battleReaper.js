'use strict';

const pool = require('../db/pool');
const { beginActivity } = require('../utils/networkTelemetry');

const STALE_BATTLE_MINUTES = 5;
const REAPER_INTERVAL_MS   = 60_000; // run every 1 minute
let reaping = false;

/**
 * Delete active_battles rows older than STALE_BATTLE_MINUTES.
 * The UNIQUE(discord_id) constraint means a stale row locks the player out of
 * new battles; removing it unlocks them automatically.
 */
async function reapStaleBattles(reason = 'periodic') {
  if (reaping) return;
  reaping = true;
  const endActivity = beginActivity('scheduler.battle_reaper');
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
  } finally {
    reaping = false;
    endActivity();
  }
}

// Restart-safe start/stop: one timer, one stable stop function.
let started = false;
let interval = null;
let stopFn = null;

/**
 * On startup: delete only stale active_battles rows.
 * Then start the periodic reaper.
 */
async function startBattleReaper() {
  if (started) return stopFn;
  started = true;
  stopFn = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    started = false;
  };
  await reapStaleBattles('startup cleanup');
  if (!started) return stopFn; // stopped while the startup cleanup was awaiting

  // Periodic reaper
  interval = setInterval(reapStaleBattles, REAPER_INTERVAL_MS);
  console.log(`[battleReaper] Periodic battle reaper started (every 1 min, threshold ${STALE_BATTLE_MINUTES} min).`);
  return stopFn;
}

module.exports = { startBattleReaper };
