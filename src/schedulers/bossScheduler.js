'use strict';

/**
 * bossScheduler — drives the per-guild boss lifecycle (Master §16, Phase 7).
 *
 * Every 60s, for each guild the bot is in: finish any interrupted defeat
 * distribution (crash-recovery safety net), and spawn a new boss when the
 * previous one has been dead for >= 15 minutes (or none ever spawned). Active
 * bosses remain until defeated. All state transitions are atomic SQL guards inside
 * bossSystem, so an overlapping tick (or a concurrent button press) can never
 * double-spawn or double-distribute — the `ticking` flag just avoids wasted
 * work in a single process.
 *
 * An immediate first pass runs on startup so interrupted defeats from before a
 * restart are settled right away.
 */

const { tickGuild } = require('../engine/bossSystem');
const { beginActivity } = require('../utils/networkTelemetry');

const TICK_MS = 60_000;

// Restart-safe start/stop: one timer, one stable stop function.
let started = false;
let interval = null;
let stopFn = null;

function startBossScheduler(client) {
  if (started) return stopFn;
  started = true;
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    const endActivity = beginActivity('scheduler.boss');
    try {
      for (const guildId of client.guilds.cache.keys()) {
        try {
          await tickGuild(client, guildId);
        } catch (err) {
          console.error(`[bossScheduler] guild ${guildId}:`, err.message);
        }
      }
    } finally {
      ticking = false;
      endActivity();
    }
  };

  interval = setInterval(tick, TICK_MS);
  tick(); // startup pass (recover overdue transitions immediately)
  console.log('[bossScheduler] Boss scheduler started (every 60s, official support server only, bosses remain until defeated).');
  stopFn = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    started = false;
  };
  return stopFn;
}

module.exports = { startBossScheduler };
