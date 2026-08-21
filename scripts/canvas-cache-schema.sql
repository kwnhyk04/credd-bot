-- canvas_cache — render-once cache for deterministic per-user canvases
-- (profile/stats cards, equipment cards, quest boards). See src/utils/canvasCache.js.
-- Apply once in the Supabase SQL editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS canvas_cache (
  cache_key    TEXT PRIMARY KEY,          -- sha256[0..39] of (ASSET_VERSION + render inputs + render rev)
  object_key   TEXT NOT NULL,             -- R2 object path, e.g. cache/canvas/<key>.jpg
  url          TEXT NOT NULL,             -- public ASSET_BASE_URL URL served in embeds
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sweep support: the startup/hourly sweep uses the single hardcoded retention
-- policy in src/utils/canvasCache.js and bounded oldest-first batches.
CREATE INDEX IF NOT EXISTS canvas_cache_last_used_idx ON canvas_cache (last_used_at);
