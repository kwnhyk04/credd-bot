'use strict';

const { getAssetCacheStats } = require('./assets');
const { getCanvasCacheStats } = require('./canvasCache');
const { getImageWorkQueueStats } = require('./imageWorkQueue');
const { getProfileImageCacheStats } = require('./profileImageCache');
const { envBool, envPositiveInt, metaString } = require('./runtimeLogs');
const { getBattleBaseCacheStats } = require('../engine/battleLayoutRenderer');
const { getResultBaseCacheStats } = require('../engine/resultLayoutRenderer');
const pool = require('../db/pool');

let interval = null;
let lastCpu = process.cpuUsage();
let lastRss = 0;
let peakRss = 0;
let warned450 = false;
let warned600 = false;

function mb(bytes) {
  return Math.round((Number(bytes) || 0) / 1024 / 1024);
}

function resourceLogsEnabled() {
  return envBool('RESOURCE_LOGS', true);
}

function intervalMs() {
  return envPositiveInt('RESOURCE_LOG_INTERVAL_MS', 600_000, { max: 3_600_000 });
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
    cache: `canvas:${canvas.entries}/inflight:${canvas.inflight}/profile:${profile.entries}/battleStatic:${Number(battleBase.entries || 0) + Number(resultBase.entries || 0)}/queue:${queue.active}+${queue.queued}/${queue.limit}`,
  };
}

function logResourceSnapshot() {
  const snapshot = resourceSnapshot();
  console.log(`[resource]${metaString(snapshot)}`);
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

function startResourceMonitor() {
  if (!resourceLogsEnabled() || interval) return null;
  lastCpu = process.cpuUsage();
  lastRss = 0;
  peakRss = 0;
  warned450 = false;
  warned600 = false;
  interval = setInterval(logResourceSnapshot, intervalMs());
  console.log(`[resource] monitor started intervalMs=${intervalMs()}`);
  logResourceSnapshot();
  return stopResourceMonitor;
}

function stopResourceMonitor() {
  if (!interval) return;
  clearInterval(interval);
  interval = null;
}

module.exports = {
  startResourceMonitor,
  stopResourceMonitor,
  resourceLogsEnabled,
};
