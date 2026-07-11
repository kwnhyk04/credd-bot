'use strict';

const { envPositiveInt, performanceLog } = require('./runtimeLogs');

const queue = [];
let active = 0;

function limit() {
  return envPositiveInt('IMAGE_RENDER_CONCURRENCY', 1, { max: 32 });
}

function maxQueued() {
  return envPositiveInt('IMAGE_RENDER_QUEUE_MAX', 32, { max: 1000 });
}

function release() {
  active = Math.max(0, active - 1);
  while (queue.length > 0 && active < limit()) {
    const next = queue.shift();
    active += 1;
    next();
  }
}

function acquire() {
  if (active < limit()) {
    active += 1;
    return Promise.resolve();
  }
  if (queue.length >= maxQueued()) {
    const err = new Error('Image rendering is temporarily busy. Please try again shortly.');
    err.code = 'IMAGE_RENDER_QUEUE_FULL';
    return Promise.reject(err);
  }
  return new Promise((resolve) => {
    queue.push(resolve);
  });
}

async function withImageWorkSlot(imageType, fn, logContext = {}) {
  const queuedAt = Date.now();
  await acquire();
  const queueWaitMs = Date.now() - queuedAt;
  const started = Date.now();
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
    release();
  }
}

function getImageWorkQueueStats() {
  return {
    active,
    queued: queue.length,
    limit: limit(),
    maxQueued: maxQueued(),
  };
}

module.exports = { withImageWorkSlot, getImageWorkQueueStats };
