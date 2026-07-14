'use strict';

const v8 = require('v8');
const { getAssetCacheStats } = require('./assets');
const { getCanvasCacheStats } = require('./canvasCache');
const { getImageWorkQueueStats } = require('./imageWorkQueue');
const { getProfileImageCacheStats } = require('./profileImageCache');
const { envBool, envPositiveInt, metaString } = require('./runtimeLogs');
const { memorySourceSnapshots } = require('./memoryRegistry');
const { takeNetworkTelemetrySnapshot } = require('./networkTelemetry');
const { getBattleBaseCacheStats } = require('../engine/battleLayoutRenderer');
const { getResultBaseCacheStats } = require('../engine/resultLayoutRenderer');
const pool = require('../db/pool');

let interval = null;
let lastCpu = process.cpuUsage();
let lastRss = 0;
let peakRss = 0;
let warned450 = false;
let warned600 = false;
let discordClient = null;
let lastPgNetwork = null;

function mb(bytes) {
  return Math.round((Number(bytes) || 0) / 1024 / 1024);
}

function resourceLogsEnabled() {
  return envBool('RESOURCE_LOGS', true);
}

function intervalMs() {
  return envPositiveInt('RESOURCE_LOG_INTERVAL_MS', 600_000, { max: 3_600_000 });
}

function discordCacheStats() {
  if (!discordClient) return {};
  let messages = 0;
  let members = 0;
  let emojis = 0;
  let roles = 0;
  let voiceStates = 0;
  let scheduledEvents = 0;
  let stickers = 0;
  for (const guild of discordClient.guilds?.cache?.values?.() || []) {
    members += guild.members?.cache?.size || 0;
    emojis += guild.emojis?.cache?.size || 0;
    roles += guild.roles?.cache?.size || 0;
    voiceStates += guild.voiceStates?.cache?.size || 0;
    scheduledEvents += guild.scheduledEvents?.cache?.size || 0;
    stickers += guild.stickers?.cache?.size || 0;
    for (const channel of guild.channels?.cache?.values?.() || []) {
      messages += channel.messages?.cache?.size || 0;
    }
  }
  const stats = {
    guilds: discordClient.guilds?.cache?.size || 0,
    channels: discordClient.channels?.cache?.size || 0,
    users: discordClient.users?.cache?.size || 0,
    messages,
    members,
    emojis,
    roles,
    voiceStates,
    scheduledEvents,
    stickers,
    applicationEmojis: discordClient.application?.emojis?.cache?.size || 0,
    listeners: discordClient.eventNames?.().reduce((sum, event) => sum + discordClient.listenerCount(event), 0) || 0,
  };
  const objectCount = stats.guilds + stats.channels + stats.users + stats.members + stats.emojis
    + stats.roles + stats.voiceStates + stats.scheduledEvents + stats.stickers + stats.applicationEmojis;
  stats.estimatedHeuristicBytes = objectCount * 1024 + stats.messages * 4096;
  stats.estimateModel = '1KiB per cached object and 4KiB per cached message';
  return stats;
}

function cacheEstimates(caches) {
  const out = {};
  for (const [name, source] of Object.entries(caches)) {
    const values = source && typeof source === 'object' ? source : {};
    const itemKeys = Object.keys(values).filter((key) => (
      /Entries$/.test(key) && !/(max|capacity|limit)/i.test(key)
    ));
    const items = Number.isFinite(Number(values.entries))
      ? Number(values.entries)
      : itemKeys.reduce((sum, key) => sum + (Number(values[key]) || 0), 0);
    let estimatedBytes = Number(values.bytes);
    let estimate = 'reported';
    if (!Number.isFinite(estimatedBytes)) {
      const byteKeys = Object.keys(values).filter((key) => (
        /(Bytes|bytes)$/.test(key)
        && !/(max|capacity|limit|upload|download|attempt|confirm)/i.test(key)
      ));
      estimatedBytes = byteKeys.reduce((sum, key) => sum + (Number(values[key]) || 0), 0);
    }
    if (!estimatedBytes && name === 'native.sharp') {
      estimatedBytes = (Number(values.cache?.memory?.current) || 0) * 1024 * 1024;
    }
    if (!estimatedBytes && items > 0) {
      estimatedBytes = items * 512;
      estimate = '512-byte object heuristic';
    }
    out[name] = { items, estimatedBytes: Math.max(0, estimatedBytes || 0), estimate };
  }
  return out;
}

function v8Snapshot() {
  const heap = v8.getHeapStatistics();
  const spaces = Object.fromEntries(v8.getHeapSpaceStatistics().map((space) => [space.space_name, {
    size: space.space_size,
    used: space.space_used_size,
    available: space.space_available_size,
    physical: space.physical_space_size,
  }]));
  return {
    heap: {
      totalHeapSize: heap.total_heap_size,
      totalHeapSizeExecutable: heap.total_heap_size_executable,
      totalPhysicalSize: heap.total_physical_size,
      totalAvailableSize: heap.total_available_size,
      usedHeapSize: heap.used_heap_size,
      heapSizeLimit: heap.heap_size_limit,
      mallocedMemory: heap.malloced_memory,
      peakMallocedMemory: heap.peak_malloced_memory,
      externalMemory: heap.external_memory,
      nativeContexts: heap.number_of_native_contexts,
      detachedContexts: heap.number_of_detached_contexts,
    },
    spaces,
  };
}

function counterDelta(current, previous) {
  const out = {};
  for (const [key, value] of Object.entries(current || {})) {
    out[key] = key === 'activeSockets'
      ? value
      : Math.max(0, (Number(value) || 0) - (Number(previous?.[key]) || 0));
  }
  return out;
}

function resourceSnapshot() {
  const mem = process.memoryUsage();
  peakRss = Math.max(peakRss, mem.rss);
  const cpu = process.cpuUsage(lastCpu);
  lastCpu = process.cpuUsage();
  const assets = getAssetCacheStats();
  const canvas = getCanvasCacheStats();
  const queue = getImageWorkQueueStats();
  const profile = getProfileImageCacheStats();
  const battleBase = getBattleBaseCacheStats();
  const resultBase = getResultBaseCacheStats();
  const battleStaticBytes = Number(battleBase.bytes || 0) + Number(resultBase.bytes || 0);
  const battleStaticMaxBytes = Number(battleBase.maxBytes || 0) + Number(resultBase.maxBytes || 0);
  const rssDelta = lastRss ? mem.rss - lastRss : 0;
  lastRss = mem.rss;
  const activeResources = typeof process.getActiveResourcesInfo === 'function'
    ? process.getActiveResourcesInfo()
    : [];
  const resourceTypes = activeResources.reduce((counts, type) => {
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  const nativeGap = Math.max(0, mem.rss - mem.heapTotal - mem.external);
  const caches = memorySourceSnapshots();
  const network = takeNetworkTelemetrySnapshot();
  const pgNetwork = pool.getNetworkStats?.() || {};
  const pgNetworkInterval = counterDelta(pgNetwork, lastPgNetwork);
  lastPgNetwork = pgNetwork;
  const v8Stats = v8Snapshot();
  const runtimeActivities = network.total.activities || {};
  const activeBattles = Object.entries(runtimeActivities)
    .filter(([name]) => name.startsWith('battle.'))
    .reduce((sum, [, stats]) => sum + (Number(stats.active) || 0), 0);
  const activeCollectors = (Number(caches['battle.runtime']?.activeCollectors) || 0)
    + (Number(caches['collectors.bestow']?.active) || 0)
    + (Number(caches['collectors.duel']?.active) || 0);
  const activity = {
    collectors: activeCollectors,
    timers: Number(resourceTypes.Timeout) || 0,
    battles: activeBattles,
    raids: Number(runtimeActivities['battle.raid']?.active) || 0,
    renderJobs: queue.active,
    queuedRenders: queue.queued,
    bossRefreshes: Number(caches['boss.runtime']?.pendingRefreshes) || 0,
  };
  return {
    rss: mb(mem.rss),
    heapUsed: mb(mem.heapUsed),
    heapTotal: mb(mem.heapTotal),
    external: mb(mem.external),
    arrayBuffers: mb(mem.arrayBuffers),
    rssDelta: mb(rssDelta),
    rssPeak: mb(peakRss),
    maxRss: mb((process.resourceUsage?.().maxRSS || 0) * 1024),
    nativeGap: mb(nativeGap),
    uptimeSec: Math.round(process.uptime()),
    userCpuMs: Math.round(cpu.user / 1000),
    systemCpuMs: Math.round(cpu.system / 1000),
    entries: assets.entries,
    bufferEntries: assets.bufferEntries,
    imageEntries: assets.imageEntries,
    diskHits: assets.diskHits,
    diskMisses: assets.diskMisses,
    assetEntries: assets.entries,
    assetMb: mb(assets.bytes),
    assetMaxMb: mb(assets.maxBytes),
    canvasEntries: canvas.entries,
    canvasMb: mb(canvas.bytes),
    canvasMaxMb: mb(canvas.maxBytes),
    battleStaticEntries: Number(battleBase.entries || 0) + Number(resultBase.entries || 0),
    battleStaticMb: mb(battleStaticBytes),
    battleStaticMaxMb: mb(battleStaticMaxBytes),
    profileEntries: profile.entries,
    queueActive: queue.active,
    queueQueued: queue.queued,
    queueLimit: queue.limit,
    pgTotal: pool.totalCount,
    pgIdle: pool.idleCount,
    pgWaiting: pool.waitingCount,
    activeResources: activeResources.length,
    resourceTypes: JSON.stringify(resourceTypes),
    discord: discordCacheStats(),
    caches,
    cacheEstimates: cacheEstimates(caches),
    processMemory: { ...mem },
    v8: v8Stats,
    network,
    pgNetwork: { total: pgNetwork, interval: pgNetworkInterval },
    loadedModules: Object.keys(require.cache).length,
    activity,
    cache: `canvas:${canvas.entries}/inflight:${canvas.inflight}/profile:${profile.entries}/battleStatic:${Number(battleBase.entries || 0) + Number(resultBase.entries || 0)}/queue:${queue.active}+${queue.queued}/${queue.limit}`,
  };
}

function logResourceSnapshot() {
  const snapshot = resourceSnapshot();
  console.log(`[resource]${metaString(snapshot)} details=${JSON.stringify({
    units: 'MB',
    memory: {
      heapUsed: snapshot.heapUsed,
      heapTotal: snapshot.heapTotal,
      rss: snapshot.rss,
      external: snapshot.external,
      arrayBuffers: snapshot.arrayBuffers,
      nativeGap: snapshot.nativeGap,
      rssDelta: snapshot.rssDelta,
      rssPeak: snapshot.rssPeak,
    },
    postgres: {
      total: snapshot.pgTotal,
      idle: snapshot.pgIdle,
      waiting: snapshot.pgWaiting,
    },
    imageQueue: {
      active: snapshot.queueActive,
      queued: snapshot.queueQueued,
      limit: snapshot.queueLimit,
    },
    discord: snapshot.discord,
    caches: snapshot.caches,
    cacheEstimates: snapshot.cacheEstimates,
    processMemoryBytes: snapshot.processMemory,
    v8: snapshot.v8,
    network: snapshot.network,
    postgresNetwork: snapshot.pgNetwork,
    loadedModules: snapshot.loadedModules,
    activity: snapshot.activity,
    activeResources: snapshot.activeResources,
    resourceTypes: JSON.parse(snapshot.resourceTypes),
  })}`);
  if (snapshot.rss >= 600 && !warned600) {
    console.warn(`[resource] RSS CRITICAL threshold=600MB${metaString(snapshot)}`);
    warned600 = true;
    warned450 = true;
  } else if (snapshot.rss >= 450 && !warned450) {
    console.warn(`[resource] RSS WARNING threshold=450MB${metaString(snapshot)}`);
    warned450 = true;
  }
  if (snapshot.rss < 450) {
    warned450 = false;
    warned600 = false;
  }
}

function startResourceMonitor({ client = null } = {}) {
  if (!resourceLogsEnabled() || interval) return null;
  discordClient = client;
  lastCpu = process.cpuUsage();
  lastRss = 0;
  peakRss = 0;
  warned450 = false;
  warned600 = false;
  lastPgNetwork = null;
  interval = setInterval(logResourceSnapshot, intervalMs());
  console.log(`[resource] monitor started intervalMs=${intervalMs()}`);
  logResourceSnapshot();
  return stopResourceMonitor;
}

function stopResourceMonitor() {
  if (!interval) return;
  clearInterval(interval);
  interval = null;
  discordClient = null;
  lastPgNetwork = null;
}

module.exports = {
  startResourceMonitor,
  stopResourceMonitor,
  resourceLogsEnabled,
  resourceSnapshot,
};
