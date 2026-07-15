'use strict';

const v8 = require('v8');
const sharp = require('sharp');
const canvasRuntime = require('@napi-rs/canvas');
const { envBool, envInt, envPositiveInt } = require('./runtimeLogs');
const { registerMemorySource } = require('./memoryRegistry');

let configured = false;

const CANVAS_TRACKER = Symbol.for('credd.canvas-runtime-tracker');
const NATIVE_CACHE_CLEAR_DELAY_MS = 1_000;

function pixelBytes(width, height) {
  const w = Number.isFinite(Number(width)) ? Math.max(0, Math.floor(Number(width))) : 0;
  const h = Number.isFinite(Number(height)) ? Math.max(0, Math.floor(Number(height))) : 0;
  return w * h * 4;
}

function canvasMemoryPoint() {
  const memory = process.memoryUsage();
  const heap = v8.getHeapStatistics();
  return {
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    v8UsedHeap: heap.used_heap_size,
    v8TotalPhysical: heap.total_physical_size,
    v8Malloced: heap.malloced_memory,
    v8External: heap.external_memory,
    nativeGapEstimate: Math.max(0, memory.rss - memory.heapTotal - memory.external),
  };
}

function memoryDelta(after, before) {
  return Object.fromEntries(
    Object.keys(after || {}).map((key) => [key, (Number(after[key]) || 0) - (Number(before?.[key]) || 0)])
  );
}

function canvasCaller() {
  const lines = String(new Error().stack || '').replace(/\\/g, '/').split('\n');
  const line = lines.find((entry) => (
    (entry.includes('/src/') || entry.includes('/scripts/'))
    && !entry.includes('/src/utils/imageRuntime.js')
  ));
  if (!line) return 'unknown';
  const src = line.includes('/src/') ? line.slice(line.indexOf('/src/') + 1) : line.slice(line.indexOf('/scripts/') + 1);
  return src.replace(/[^a-zA-Z0-9_./:() -]+/g, '_').trim().slice(0, 180);
}

function canvasContext() {
  try {
    // Lazy import avoids a startup dependency cycle. getNetworkContext returns
    // only sanitized values and per-process hashes, never raw user/request IDs.
    return require('./networkTelemetry').getNetworkContext();
  } catch {
    return { command: 'background', imageType: '', surface: 'system', phase: 'background' };
  }
}

function logCanvasLifecycle(record, beforeRelease, afterRelease) {
  if (!record?.beforeCreate || !envBool('RESOURCE_LOGS', true)) return;
  try {
    console.log(`[renderer-memory] ${JSON.stringify({
      kind: 'canvas-lifecycle',
      command: record.context.command,
      imageType: record.context.imageType || 'canvas',
      surface: record.context.surface,
      phase: record.context.phase,
      userHash: record.context.userHash || undefined,
      correlationId: record.context.correlationId || undefined,
      renderer: record.caller,
      width: record.width,
      height: record.height,
      pixelBytes: record.bytes,
      lifetimeMs: Date.now() - record.createdAt,
      before: record.beforeCreate,
      afterCreate: record.afterCreate,
      beforeRelease,
      after: afterRelease,
      createDelta: memoryDelta(record.afterCreate, record.beforeCreate),
      releaseDelta: memoryDelta(afterRelease, beforeRelease),
      lifetimeDelta: memoryDelta(afterRelease, record.beforeCreate),
    })}`);
  } catch {
    // Renderer telemetry must never alter image output or cleanup.
  }
}

function installCanvasTracker() {
  if (canvasRuntime[CANVAS_TRACKER]) return canvasRuntime[CANVAS_TRACKER];

  const state = {
    originalCreateCanvas: canvasRuntime.createCanvas,
    records: new WeakMap(),
    createdCanvases: 0,
    activeCanvases: 0,
    peakActiveCanvases: 0,
    activePixelBytes: 0,
    peakPixelBytes: 0,
    explicitReleases: 0,
    finalizedReleases: 0,
    untrackedReleases: 0,
    cacheClearTimer: null,
    cacheClearRequests: 0,
    cacheClearReschedules: 0,
    cacheClears: 0,
    cacheClearFailures: 0,
    lastCacheClearScheduledAt: null,
    lastCacheClearAt: null,
    lastCacheClearDurationMs: null,
  };

  const finishRecord = (record, releaseKind) => {
    if (!record?.active) return false;
    record.active = false;
    state.activeCanvases = Math.max(0, state.activeCanvases - 1);
    state.activePixelBytes = Math.max(0, state.activePixelBytes - record.bytes);
    if (releaseKind === 'explicit') state.explicitReleases += 1;
    else state.finalizedReleases += 1;
    return true;
  };

  state.finalizer = typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry((record) => finishRecord(record, 'finalized'))
    : null;

  canvasRuntime.createCanvas = function trackedCreateCanvas(...args) {
    const telemetryEnabled = envBool('RESOURCE_LOGS', true);
    const beforeCreate = telemetryEnabled ? canvasMemoryPoint() : null;
    const canvas = state.originalCreateCanvas.apply(this, args);
    const record = {
      active: true,
      bytes: pixelBytes(canvas?.width, canvas?.height),
      width: Number(canvas?.width) || 0,
      height: Number(canvas?.height) || 0,
      createdAt: Date.now(),
      beforeCreate,
      afterCreate: telemetryEnabled ? canvasMemoryPoint() : null,
      caller: telemetryEnabled ? canvasCaller() : null,
      context: telemetryEnabled ? canvasContext() : null,
      unregisterToken: {},
    };
    state.records.set(canvas, record);
    state.finalizer?.register(canvas, record, record.unregisterToken);
    state.createdCanvases += 1;
    state.activeCanvases += 1;
    state.activePixelBytes += record.bytes;
    state.peakActiveCanvases = Math.max(state.peakActiveCanvases, state.activeCanvases);
    state.peakPixelBytes = Math.max(state.peakPixelBytes, state.activePixelBytes);
    return canvas;
  };

  state.markReleased = (canvas, beforeRelease = null) => {
    const record = canvas && state.records.get(canvas);
    if (!record) {
      state.untrackedReleases += 1;
      return false;
    }
    if (!record.active) return false;
    state.finalizer?.unregister(record.unregisterToken);
    const released = finishRecord(record, 'explicit');
    if (released && record.beforeCreate) {
      const afterRelease = canvasMemoryPoint();
      logCanvasLifecycle(record, beforeRelease || afterRelease, afterRelease);
    }
    return released;
  };

  Object.defineProperty(canvasRuntime, CANVAS_TRACKER, {
    value: state,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return state;
}

const canvasTracker = installCanvasTracker();

function imageRuntimeConfig() {
  return {
    memoryMb: envPositiveInt('SHARP_CACHE_MEMORY_MB', 8, { max: 256 }),
    files: envInt('SHARP_CACHE_FILES', 0, { min: 0, max: 100 }),
    items: envInt('SHARP_CACHE_ITEMS', 20, { min: 0, max: 1000 }),
    concurrency: envPositiveInt('SHARP_CONCURRENCY', 1, { max: 32 }),
  };
}

function configureImageRuntime() {
  if (configured) return;
  configured = true;
  const config = imageRuntimeConfig();
  sharp.cache({ memory: config.memoryMb, files: config.files, items: config.items });
  sharp.concurrency(config.concurrency);
}

function getImageRuntimeStats() {
  const cache = sharp.cache();
  return {
    concurrency: sharp.concurrency(),
    queue: sharp.queue?.length || 0,
    counters: sharp.counters(),
    cache,
  };
}

function markCanvasReleased(canvas, beforeRelease = null) {
  return canvasTracker.markReleased(canvas, beforeRelease);
}

function flushCanvasNativeCache() {
  if (canvasTracker.cacheClearTimer) {
    clearTimeout(canvasTracker.cacheClearTimer);
    canvasTracker.cacheClearTimer = null;
  }
  if (typeof canvasRuntime.clearAllCache !== 'function') return false;

  const started = Date.now();
  try {
    canvasRuntime.clearAllCache();
    canvasTracker.cacheClears += 1;
    canvasTracker.lastCacheClearAt = new Date().toISOString();
    canvasTracker.lastCacheClearDurationMs = Date.now() - started;
    return true;
  } catch {
    canvasTracker.cacheClearFailures += 1;
    canvasTracker.lastCacheClearDurationMs = Date.now() - started;
    return false;
  }
}

function scheduleCanvasNativeCacheClear() {
  canvasTracker.cacheClearRequests += 1;
  canvasTracker.lastCacheClearScheduledAt = new Date().toISOString();
  if (canvasTracker.cacheClearTimer) {
    clearTimeout(canvasTracker.cacheClearTimer);
    canvasTracker.cacheClearReschedules += 1;
  }
  canvasTracker.cacheClearTimer = setTimeout(() => {
    canvasTracker.cacheClearTimer = null;
    flushCanvasNativeCache();
  }, NATIVE_CACHE_CLEAR_DELAY_MS);
  canvasTracker.cacheClearTimer.unref?.();
}

function getCanvasRuntimeStats() {
  return {
    createdCanvases: canvasTracker.createdCanvases,
    activeCanvases: canvasTracker.activeCanvases,
    peakActiveCanvases: canvasTracker.peakActiveCanvases,
    activePixelBytes: canvasTracker.activePixelBytes,
    peakPixelBytes: canvasTracker.peakPixelBytes,
    explicitReleases: canvasTracker.explicitReleases,
    finalizedReleases: canvasTracker.finalizedReleases,
    untrackedReleases: canvasTracker.untrackedReleases,
    nativeCacheClearAvailable: typeof canvasRuntime.clearAllCache === 'function',
    nativeCacheClearPending: Boolean(canvasTracker.cacheClearTimer),
    nativeCacheClearDelayMs: NATIVE_CACHE_CLEAR_DELAY_MS,
    nativeCacheClearRequests: canvasTracker.cacheClearRequests,
    nativeCacheClearReschedules: canvasTracker.cacheClearReschedules,
    nativeCacheClears: canvasTracker.cacheClears,
    nativeCacheClearFailures: canvasTracker.cacheClearFailures,
    lastNativeCacheClearScheduledAt: canvasTracker.lastCacheClearScheduledAt,
    lastNativeCacheClearAt: canvasTracker.lastCacheClearAt,
    lastNativeCacheClearDurationMs: canvasTracker.lastCacheClearDurationMs,
  };
}

configureImageRuntime();
registerMemorySource('native.sharp', getImageRuntimeStats);
registerMemorySource('native.canvas', getCanvasRuntimeStats);

module.exports = {
  configureImageRuntime,
  canvasMemoryPoint,
  flushCanvasNativeCache,
  getCanvasRuntimeStats,
  getImageRuntimeStats,
  markCanvasReleased,
  scheduleCanvasNativeCacheClear,
};
