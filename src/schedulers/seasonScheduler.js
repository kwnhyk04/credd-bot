'use strict';

const cron = require('node-cron');
const pool = require('../db/pool');
const seasonEngine = require('../engine/seasonEngine');

/**
 * Season rollover check — daily 00:05 PHT (just after the midnight reset).
 * rolloverIfDue is idempotent: it only acts when the active season's window has
 * ended, so a daily tick is enough to catch a 2-month boundary.
 */
// Restart-safe start/stop: one cron task, one stable stop function.
let started = false;
let task = null;
let stopFn = null;

function startSeasonScheduler() {
  if (started) return stopFn;
  started = true;
  task = cron.schedule('5 0 * * *', async () => {
    try {
      const res = await seasonEngine.rolloverIfDue(pool);
      if (res.rolled) {
        console.log(`[seasonScheduler] Rolled season ${res.endedSeason} → ${res.nextSeason} (paid ${res.paid}).`);
      }
    } catch (err) {
      console.error('[seasonScheduler] rollover error:', err.message);
    }
  }, { timezone: 'Asia/Manila' });
  console.log('[seasonScheduler] started (daily 00:05 PHT).');
  stopFn = () => {
    if (task) {
      task.stop();
      task = null;
    }
    started = false;
  };
  return stopFn;
}

module.exports = { startSeasonScheduler };
