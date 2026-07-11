'use strict';

const { envPositiveInt, performanceLog } = require('./runtimeLogs');

const queue = [];
let active = 0;

function limit() {
  return envPositiveInt('IMAGE_RENDER_CONCURRENCY', 1, { max: 32 });
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
  };
}

module.exports = { withImageWorkSlot, getImageWorkQueueStats };
