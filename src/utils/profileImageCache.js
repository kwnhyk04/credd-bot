'use strict';

const { registerMemorySource } = require('./memoryRegistry');

const crypto = require('crypto');
const { envNumber, envPositiveInt, performanceLog } = require('./runtimeLogs');

const cache = new Map();

function ttlMs() {
  return Math.floor(envNumber('PROFILE_IMAGE_CACHE_TTL_MS', 60_000, { min: 0, max: 3_600_000 }));
}

function maxEntries() {
  return envPositiveInt('PROFILE_IMAGE_CACHE_MAX', 50, { max: 1000 });
}

function signature(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function trim() {
  while (cache.size > maxEntries()) {
    cache.delete(cache.keys().next().value);
  }
}

function sweepExpired(now = Date.now()) {
  const ttl = ttlMs();
  if (ttl <= 0) {
    cache.clear();
    return;
  }
  for (const [key, entry] of cache) {
    if (now - entry.createdAt > ttl) cache.delete(key);
  }
}

function getProfileImageCache(userId, expectedSignature, logContext = {}) {
  const ttl = ttlMs();
  if (ttl <= 0) return null;
  const entry = cache.get(userId);
  if (!entry) {
    performanceLog('profile image cache miss', { ...logContext, cache: 'memory-miss' });
    return null;
  }
  if (Date.now() - entry.createdAt > ttl || entry.signature !== expectedSignature) {
    cache.delete(userId);
    performanceLog('profile image cache miss', { ...logContext, cache: 'stale' });
    return null;
  }
  cache.delete(userId);
  cache.set(userId, entry);
  performanceLog('profile image cache hit', { ...logContext, cache: 'memory' });
  return entry.url;
}

function setProfileImageCache(userId, imageSignature, url) {
  if (!url || ttlMs() <= 0) return;
  cache.delete(userId);
  cache.set(userId, {
    signature: imageSignature,
    url,
    createdAt: Date.now(),
  });
  trim();
}

function getProfileImageCacheStats() {
  sweepExpired();
  return {
    entries: cache.size,
    maxEntries: maxEntries(),
    ttlMs: ttlMs(),
  };
}

registerMemorySource('profile.urls', getProfileImageCacheStats);

module.exports = {
  signature,
  getProfileImageCache,
  setProfileImageCache,
  getProfileImageCacheStats,
};
