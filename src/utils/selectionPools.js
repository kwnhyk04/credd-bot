'use strict';

const {
  envNumber, envPositiveInt, performanceLog,
} = require('./runtimeLogs');
const { registerMemorySource } = require('./memoryRegistry');

const pools = new Map();

function ttlMs() {
  return Math.floor(envNumber('SELECTION_POOL_CACHE_TTL_MS', 300_000, { min: 0, max: 3_600_000 }));
}

function maxEntries() {
  return envPositiveInt('SELECTION_POOL_CACHE_MAX', 50, { max: 1000 });
}

function poolKey(parts) {
  return JSON.stringify(parts);
}

function trimPools() {
  while (pools.size > maxEntries()) {
    pools.delete(pools.keys().next().value);
  }
}

async function getSelectionPool(parts, loader, logContext = {}) {
  const key = poolKey(parts);
  const ttl = ttlMs();
  const now = Date.now();
  if (ttl > 0) {
    const cached = pools.get(key);
    if (cached && cached.expiresAt > now) {
      pools.delete(key);
      pools.set(key, cached);
      performanceLog('selection pool cache hit', {
        ...logContext,
        cache: 'hit',
        poolKey: key,
        poolSize: cached.rows.length,
      });
      return cached.rows;
    }
    if (cached) pools.delete(key);
  }

  const started = Date.now();
  const rows = await loader();
  if (ttl > 0) {
    pools.set(key, { rows, expiresAt: now + ttl });
    trimPools();
  }
  performanceLog('selection pool loaded', {
    ...logContext,
    cache: ttl > 0 ? 'miss' : 'disabled',
    poolKey: key,
    poolSize: rows.length,
    durationMs: Date.now() - started,
  });
  return rows;
}

function pickRandomRow(rows, rng = Math.random) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[Math.floor(rng() * rows.length)];
}

function getSelectionPoolStats() {
  const now = Date.now();
  for (const [key, entry] of pools) {
    if (entry.expiresAt <= now) pools.delete(key);
  }
  let rows = 0;
  for (const entry of pools.values()) rows += entry.rows?.length || 0;
  return {
    entries: pools.size,
    rows,
    maxEntries: maxEntries(),
    ttlMs: ttlMs(),
  };
}

registerMemorySource('database.selection-pools', getSelectionPoolStats);

module.exports = {
  getSelectionPool,
  pickRandomRow,
  getSelectionPoolStats,
};
