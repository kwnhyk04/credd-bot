'use strict';

const { registerMemorySource } = require('./memoryRegistry');

const { envPositiveInt, performanceLog } = require('./runtimeLogs');

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

async function withImageWorkSlot(imageType, fn, logContext = {}) {
  const queuedAt = Date.now();
  const ticket = await acquire();
  const queueWaitMs = Date.now() - queuedAt;
  const started = Date.now();
  activeJobs.set(ticket, { startedAt: started, imageType: imageType || logContext.imageType || 'image' });
  try {
    return await fn();
  } finally {
    const durationMs = Date.now() - started;
    performanceLog('image render slot', {
      ...logContext,
      imageType: imageType || logContext.imageType,
      queueWaitMs,
      durationMs,
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
