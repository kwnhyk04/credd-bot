'use strict';

/**
 * bossRuntime.js — in-memory boss state and its lifecycle (Phase 2.2 split of
 * bossSystem.js; all bodies moved VERBATIM).
 *
 * Every Map/Set here is `const`, so exporting the object itself gives each
 * importer the SAME instance — there is exactly one copy of each and mutations
 * are visible everywhere. (The require-time staleness hazard applies only to
 * reassignable bindings, which is why bossRender exposes renderMemoryStats()
 * instead of its counters.)
 *
 * Nothing here requires the bossSystem facade: that would create a cycle.
 */

const {
  envNumber, envPositiveInt, performanceLog,
} = require('../../utils/runtimeLogs');
const { registerMemorySource } = require('../../utils/memoryRegistry');
const {
  isGreaterBoss, isCalamityBoss, rollBossChest, inferChestFromGreaterHp, bossChestForSpawn,
} = require('../../config/bosses');
const {
  renderMemoryStats, trimBossBanners, dropStatusUrlsForSpawn, dropStatusUrlsForGuild,
} = require('./bossRender');

/* ── in-memory state ────────────────────────────────────────────────────── */
const liveMessages = new Map();  // guildId → { channelId, messageId }
const logCache = new Map();      // `${spawnId}:${discordId}` → sim
const logCacheOrder = new Map(); // spawnId → Map<discordId, timestamp>
const currentSpawn = new Map();  // guildId → spawnId (for logCache purging)
const pendingBossRefreshes = new Map(); // guildId -> { timer, spawnId }
const lastBossReconciliations = new Map(); // guildId -> last scheduler reconciliation attempt
const nonOfficialRedirects = new Map(); // guildId -> ms of last redirect notice
// Greater Boss chest rolled once at spawn, keyed by spawn_id. After a restart,
// chestForSpawn reconstructs the outcome from persisted max_hp before falling
// back to a roll for legacy spawns that predate chest-linked HP.
const greaterChests = new Map(); // spawnId → { column, qty, label }
// Legacy in-memory cache for dev-spawn diagnostics; persisted spawn_source is
// authoritative, so dev behavior survives a process restart.
const devSpawns = new Set();

function bossProgressRefreshDebounceMs() {
  // Coalesce nearby attacks into one latest-HP Canvas refresh.
  return envNumber('BOSS_IMAGE_REFRESH_DEBOUNCE_MS', 15_000, { min: 1_000, max: 300_000 });
}

function bossLogCacheMaxAttackers() {
  return envPositiveInt('BOSS_LOG_CACHE_MAX_ATTACKERS', 50, { max: 500 });
}

function bossLogCacheMaxEventsPerAttacker() {
  return envPositiveInt('BOSS_LOG_CACHE_MAX_EVENTS_PER_ATTACKER', 20, { max: 500 });
}

function clearPendingBossRefresh(guildId, reason = 'cleared') {
  const pending = pendingBossRefreshes.get(guildId);
  if (!pending) return Promise.resolve();
  pending.cancelled = true;
  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = null;
  pendingBossRefreshes.delete(guildId);
  if (!pending.running) pending.finish();
  bandwidthLog('boss progress refresh skipped', {
    system: 'boss',
    command: 'boss:attack',
    imageType: 'boss_status',
    guildId,
    spawnId: pending.spawnId,
    reason,
  });
  // Callers that are about to publish a terminal/lifecycle message can await
  // this. If an edit was already in flight, the terminal edit is then sent
  // after it and cannot be overwritten by stale progress state.
  return pending.done;
}

function rememberSpawn(guildId, spawnId) {
  const old = currentSpawn.get(guildId);
  if (old && old !== spawnId) {
    clearPendingBossRefresh(guildId, 'spawn-replaced');
    purgeBossRuntimeForSpawn(old, 'spawn-replaced');
    lastBossReconciliations.delete(guildId);
  }
  currentSpawn.set(guildId, spawnId);
}

function bossLogKey(spawnId, discordId) {
  return `${spawnId}:${discordId}`;
}

function compactBossSim(sim) {
  const rounds = Array.isArray(sim?.rounds) ? sim.rounds : [];
  return {
    seed: sim.seed,
    winner: sim.winner,
    outcome: sim.outcome,
    mode: sim.mode || 'boss',
    a: { name: sim.a?.name || 'Player' },
    b: { name: sim.b?.name || 'Boss' },
    rounds: rounds.map((round) => ({ round: round.round, events: [...(round.events || [])] })),
  };
}

function rememberBossLog(spawnId, discordId, sim) {
  const maxAttackers = bossLogCacheMaxAttackers();
  let order = logCacheOrder.get(spawnId);
  if (!order) {
    order = new Map();
    logCacheOrder.set(spawnId, order);
  }

  if (order.has(discordId)) order.delete(discordId);
  while (order.size >= maxAttackers) {
    const evictedUser = order.keys().next().value;
    order.delete(evictedUser);
    logCache.delete(bossLogKey(spawnId, evictedUser));
    performanceLog('boss log attacker evicted', {
      system: 'boss',
      command: 'boss:attack',
      spawnId,
      userId: evictedUser,
      attackers: order.size,
      limit: maxAttackers,
    });
  }

  order.set(discordId, Date.now());
  logCache.set(bossLogKey(spawnId, discordId), compactBossSim(sim));
}

function purgeBossRuntimeForSpawn(spawnId, reason = 'cleared') {
  if (!spawnId) return;
  let removed = 0;
  const order = logCacheOrder.get(spawnId);
  if (order) {
    for (const discordId of order.keys()) {
      if (logCache.delete(bossLogKey(spawnId, discordId))) removed += 1;
    }
    logCacheOrder.delete(spawnId);
  } else {
    for (const key of logCache.keys()) {
      if (key.startsWith(`${spawnId}:`)) {
        logCache.delete(key);
        removed += 1;
      }
    }
  }
  greaterChests.delete(spawnId);
  devSpawns.delete(spawnId);
  dropStatusUrlsForSpawn(spawnId);
  performanceLog('boss runtime cache cleared', {
    system: 'boss',
    command: 'boss',
    spawnId,
    reason,
    removed,
  });
}

function purgeBossRuntimeForGuild(guildId, reason = 'cleared') {
  const spawnId = currentSpawn.get(guildId);
  if (spawnId) purgeBossRuntimeForSpawn(spawnId, reason);
  currentSpawn.delete(guildId);
  lastBossReconciliations.delete(guildId);
}

function clearBossRuntimeForGuild(guildId, reason = 'guild-removed') {
  clearPendingBossRefresh(guildId, reason);
  purgeBossRuntimeForGuild(guildId, reason);
  liveMessages.delete(guildId);
  nonOfficialRedirects.delete(guildId);
  dropStatusUrlsForGuild(guildId);
}

function chestForSpawn(
  spawnId,
  bossName,
  { baseHp = null, maxHp = null, spawnSource = 'natural' } = {}
) {
  if (isCalamityBoss(bossName)) return bossChestForSpawn(bossName, spawnSource);
  if (!isGreaterBoss(bossName)) return rollBossChest(bossName); // fixed 1× treasure
  if (!greaterChests.has(spawnId)) {
    greaterChests.set(
      spawnId,
      inferChestFromGreaterHp(baseHp, maxHp)
        || rollBossChest(bossName)
    );
  }
  return greaterChests.get(spawnId);
}

function getBossMemoryStats() {
  trimBossBanners();
  let logEvents = 0;
  let estimatedLogBytes = 0;
  for (const sim of logCache.values()) {
    logEvents += (sim.rounds || []).reduce((sum, round) => sum + (round.events?.length || 0), 0);
    try { estimatedLogBytes += Buffer.byteLength(JSON.stringify(sim)); } catch { /* counters only */ }
  }
  const pending = [...pendingBossRefreshes.values()];
  const render = renderMemoryStats();
  return {
    liveMessages: liveMessages.size,
    logEntries: logCache.size,
    logSpawnEntries: logCacheOrder.size,
    logEvents,
    estimatedLogBytes,
    currentSpawns: currentSpawn.size,
    pendingRefreshes: pendingBossRefreshes.size,
    runningRefreshes: pending.filter((entry) => entry.running).length,
    reconciliationEntries: lastBossReconciliations.size,
    redirectEntries: nonOfficialRedirects.size,
    statusUrlEntries: render.statusUrlEntries,
    greaterChestEntries: greaterChests.size,
    devSpawnEntries: devSpawns.size,
    bannerEntries: render.bannerEntries,
    bannerBytes: render.bannerBytes,
    bannerMaxEntries: render.bannerMaxEntries,
    bannerMaxBytes: render.bannerMaxBytes,
    bannerTtlMs: render.bannerTtlMs,
    loreEntries: render.loreEntries,
    assetFileEntries: render.assetFileEntries,
    assetLookupEntries: render.assetLookupEntries,
  };
}

registerMemorySource('boss.runtime', getBossMemoryStats);

module.exports = {
  liveMessages,
  logCache,
  logCacheOrder,
  currentSpawn,
  pendingBossRefreshes,
  lastBossReconciliations,
  nonOfficialRedirects,
  greaterChests,
  devSpawns,
  bossProgressRefreshDebounceMs,
  bossLogCacheMaxAttackers,
  bossLogCacheMaxEventsPerAttacker,
  clearPendingBossRefresh,
  rememberSpawn,
  bossLogKey,
  compactBossSim,
  rememberBossLog,
  purgeBossRuntimeForSpawn,
  purgeBossRuntimeForGuild,
  clearBossRuntimeForGuild,
  chestForSpawn,
  getBossMemoryStats,
};
