'use strict';

const v8 = require('v8');
const { registerMemorySource } = require('./memoryRegistry');

const { envBool, envPositiveInt, performanceLog } = require('./runtimeLogs');
const { getNetworkContext } = require('./networkTelemetry');

const queue = [];
let active = 0;
let ticketSequence = 0;
const activeJobs = new Map();

function limit() {
  return envPositiveInt('IMAGE_RENDER_CONCURRENCY', 1, { max: 32 });
}

function maxQueued() {
  return envPositiveInt('IMAGE_RENDER_QUEUE_MAX', 16, { max: 1000 });
}

function release(ticket) {
  activeJobs.delete(ticket);
  active = Math.max(0, active - 1);
  while (queue.length > 0 && active < limit()) {
    const next = queue.shift();
    active += 1;
    next.resolve(next.ticket);
  }
}

function acquire() {
  const ticket = ++ticketSequence;
  if (active < limit()) {
    active += 1;
    return Promise.resolve(ticket);
  }
  if (queue.length >= maxQueued()) {
    const err = new Error('Image rendering is temporarily busy. Please try again shortly.');
    err.code = 'IMAGE_RENDER_QUEUE_FULL';
    return Promise.reject(err);
  }
  return new Promise((resolve) => {
    queue.push({ resolve, ticket, queuedAt: Date.now() });
  });
}

function rendererMemoryPoint() {
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
    v8PeakMalloced: heap.peak_malloced_memory,
    v8External: heap.external_memory,
    nativeGapEstimate: Math.max(0, memory.rss - memory.heapTotal - memory.external),
  };
}

function memoryDelta(after, before) {
  return Object.fromEntries(
    Object.keys(after).map((key) => [key, (Number(after[key]) || 0) - (Number(before[key]) || 0)])
  );
}

function safeErrorField(value, fallback) {
  const safe = String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64);
  return safe || fallback;
}

function logRendererMemory(event) {
  if (!envBool('RESOURCE_LOGS', true)) return;
  try {
    console.log(`[renderer-memory] ${JSON.stringify(event)}`);
  } catch {
    // Telemetry must never change renderer behavior.
  }
}

async function withImageWorkSlot(imageType, fn, logContext = {}) {
  const queuedAt = Date.now();
  const ticket = await acquire();
  const queueWaitMs = Date.now() - queuedAt;
  const started = Date.now();
  const telemetryContext = getNetworkContext({
    ...logContext,
    imageType: imageType || logContext.imageType || 'image',
  });
  const before = rendererMemoryPoint();
  let failure = null;
  activeJobs.set(ticket, {
    startedAt: started,
    imageType: telemetryContext.imageType || 'image',
    command: telemetryContext.command,
    phase: telemetryContext.phase,
  });
  try {
    return await fn();
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    const durationMs = Date.now() - started;
    const after = rendererMemoryPoint();
    performanceLog('image render slot', {
      command: telemetryContext.command,
      imageType: telemetryContext.imageType,
      phase: telemetryContext.phase,
      queueWaitMs,
      durationMs,
    });
    logRendererMemory({
      command: telemetryContext.command,
      imageType: telemetryContext.imageType || 'image',
      surface: telemetryContext.surface,
      phase: telemetryContext.phase,
      userHash: telemetryContext.userHash || undefined,
      correlationId: telemetryContext.correlationId || undefined,
      queueWaitMs,
      durationMs,
      status: failure ? 'error' : 'ok',
      errorName: failure ? safeErrorField(failure.name, 'Error') : undefined,
      errorCode: failure?.code ? safeErrorField(failure.code, 'error') : undefined,
      before,
      after,
      delta: memoryDelta(after, before),
    });
    release(ticket);
  }
}

function getImageWorkQueueStats() {
  const now = Date.now();
  const oldestQueuedAt = queue.reduce((oldest, entry) => Math.min(oldest, entry.queuedAt), now);
  const oldestActiveAt = [...activeJobs.values()].reduce((oldest, entry) => Math.min(oldest, entry.startedAt), now);
  return {
    active,
    queued: queue.length,
    limit: limit(),
    maxQueued: maxQueued(),
    oldestQueuedMs: queue.length ? now - oldestQueuedAt : 0,
    oldestActiveMs: activeJobs.size ? now - oldestActiveAt : 0,
  };
}

registerMemorySource('images.work-queue', getImageWorkQueueStats);

module.exports = { withImageWorkSlot, getImageWorkQueueStats };
