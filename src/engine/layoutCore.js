'use strict';

/**
 * layoutCore.js — shared layout-config loading for the skin layout renderers
 * (Phase 1.3 dedup of the verbatim-identical loadLayout + LRU cache blocks in
 * statsLayoutRenderer.js and profileLayoutRenderer.js).
 *
 * createLayoutCache() is a FACTORY: each renderer keeps its own cache instance
 * with its own LAYOUT_METADATA_CACHE_MAX budget, exactly as before the move —
 * merging them into one shared cache would change eviction behavior and is
 * deliberately not done.
 */

const {
  assetSource,
  assetSignatureSync,
  readAssetJson,
} = require('../utils/assets');
const { envPositiveInt } = require('../utils/runtimeLogs');

function createLayoutCache() {
  const LAYOUT_CACHE_MAX = envPositiveInt('LAYOUT_METADATA_CACHE_MAX', 64, { max: 500 });
  const layoutCache = new Map(); // layout path -> { mtimeMs, layout }

  async function loadLayout(configPath) {
    const resolved = assetSource(configPath);
    const mtimeMs = assetSignatureSync(resolved);
    const cached = layoutCache.get(resolved);
    if (cached && cached.mtimeMs === mtimeMs) {
      layoutCache.delete(resolved);
      layoutCache.set(resolved, cached);
      return cached.layout;
    }

    const layout = await readAssetJson(resolved);
    layoutCache.set(resolved, { mtimeMs, layout });
    while (layoutCache.size > LAYOUT_CACHE_MAX) layoutCache.delete(layoutCache.keys().next().value);
    return layout;
  }

  function layoutCacheStats() {
    return { entries: layoutCache.size, maxEntries: LAYOUT_CACHE_MAX };
  }

  return { loadLayout, layoutCacheStats };
}

module.exports = { createLayoutCache };
