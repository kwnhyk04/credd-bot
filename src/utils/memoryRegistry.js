'use strict';

// Snapshot callbacks expose counters without retaining cache contents.
const sources = new Map();

function registerMemorySource(name, snapshot) {
  if (!name || typeof snapshot !== 'function') return () => {};
  sources.set(String(name), snapshot);
  return () => sources.delete(String(name));
}

function memorySourceSnapshots() {
  const out = {};
  for (const name of [...sources.keys()].sort()) {
    try {
      out[name] = sources.get(name)() || {};
    } catch (err) {
      out[name] = { error: err?.message || String(err) };
    }
  }
  return out;
}

function getMemoryRegistryStats() {
  return { entries: sources.size };
}

module.exports = {
  registerMemorySource,
  memorySourceSnapshots,
  getMemoryRegistryStats,
};
