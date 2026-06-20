'use strict';

/**
 * guildConfigCache.js — one in-memory snapshot of `server_config`, loaded once at startup
 * (Phase 11, §1.2). Replaces the old lazy prefix Map + the per-command `bot_channel_id` SELECT:
 * middleware now reads prefix AND bot-channel from this cache with zero DB hits on the hot path.
 *
 * `crd admin set*` updates the DB (UPSERT) and then `setField` here in the same code path, so a
 * write is never followed by a stale read. A guild with no row uses DEFAULTS (prefix 'crd', all
 * channels null) — identical to "no restriction".
 */

const pool = require('../db/pool');

const cache = new Map(); // guildId -> { prefix, bot_channel_id, announcement_channel_id, boss_announcement_channel_id }

const DEFAULTS = Object.freeze({
  prefix: 'crd',
  bot_channel_id: null,
  announcement_channel_id: null,
  boss_announcement_channel_id: null,
});

/** Load every server_config row into the cache. Call once on `ready`. Returns the row count. */
async function loadAll() {
  const { rows } = await pool.query(
    `SELECT guild_id, prefix, bot_channel_id, announcement_channel_id, boss_announcement_channel_id
       FROM server_config`
  );
  cache.clear();
  for (const r of rows) {
    cache.set(r.guild_id, {
      prefix: r.prefix || 'crd',
      bot_channel_id: r.bot_channel_id || null,
      announcement_channel_id: r.announcement_channel_id || null,
      boss_announcement_channel_id: r.boss_announcement_channel_id || null,
    });
  }
  return cache.size;
}

/** Full config for a guild (DEFAULTS when unconfigured). Never null. */
function getConfig(guildId) {
  return cache.get(guildId) || DEFAULTS;
}

/** The guild's custom prefix, or 'crd' when unset. */
function getPrefix(guildId) {
  const c = cache.get(guildId);
  return (c && c.prefix) || 'crd';
}

/** Update ONE field in the cache after a successful DB UPSERT (creates the entry if absent). */
function setField(guildId, field, value) {
  const cur = cache.get(guildId) || { ...DEFAULTS };
  cur[field] = value;
  cache.set(guildId, cur);
}

module.exports = { loadAll, getConfig, getPrefix, setField, cache, DEFAULTS };
