'use strict';

const sharp = require('sharp');
const { envInt, envPositiveInt } = require('./runtimeLogs');
const { registerMemorySource } = require('./memoryRegistry');

let configured = false;

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

configureImageRuntime();
registerMemorySource('native.sharp', getImageRuntimeStats);

module.exports = { configureImageRuntime, getImageRuntimeStats };
