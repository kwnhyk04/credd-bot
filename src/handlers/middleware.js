'use strict';

const pool = require('../db/pool');
const { replyError } = require('../utils/errorHandler');

// In-memory cooldown store: discord_id → timestamp of last command
const cooldowns = new Map();
const COOLDOWN_MS = 10_000;

// In-memory prefix cache: guild_id → prefix string
const prefixCache = new Map();
const DEFAULT_PREFIX = 'crd';

/**
 * Load a guild's prefix from the DB (or return cached value).
 * Falls back to DEFAULT_PREFIX on any error or if not configured.
 */
async function getPrefix(guildId) {
  if (prefixCache.has(guildId)) return prefixCache.get(guildId);
  try {
    const { rows } = await pool.query(
      'SELECT prefix FROM server_config WHERE guild_id = $1',
      [guildId]
    );
    const prefix = rows[0]?.prefix ?? DEFAULT_PREFIX;
    prefixCache.set(guildId, prefix);
    return prefix;
  } catch {
    return DEFAULT_PREFIX;
  }
}

/**
 * Invalidate cached prefix for a guild (call after setprefix command succeeds).
 */
function invalidatePrefixCache(guildId) {
  prefixCache.delete(guildId);
}

/**
 * Lightweight ban check by discord id. Returns true if the user IS banned.
 * Used by `crd register` (which skips the full pipeline) and by button
 * interactions (which bypass message middleware entirely).
 * Fails CLOSED: on DB error, returns true (treat as banned / block) so a
 * hiccup never lets a write through unchecked.
 */
async function isBanned(discordId) {
  try {
    const { rows } = await pool.query(
      'SELECT is_banned FROM users WHERE discord_id = $1',
      [discordId]
    );
    return rows[0]?.is_banned === true;
  } catch (err) {
    console.error('[middleware] isBanned error:', err.message);
    return true;
  }
}

/**
 * Middleware pipeline — runs before every RPG/economy/casino/admin/dev command.
 *
 * Order (Blueprint §4):
 *   1. Ban check
 *   2. Registration check
 *   3. Character check  (RPG commands only — pass requiresCharacter = true)
 *   4. Bot-channel check
 *   5. 10-second cooldown
 *   6. UPSERT user_guild_activity
 *
 * Returns true if the command should proceed, false if it was blocked.
 */
async function runMiddleware(message, { requiresCharacter = false } = {}) {
  const discordId = message.author.id;
  const guildId   = message.guild?.id;

  // ── 1. Ban check ─────────────────────────────────────────────────────────
  try {
    const { rows } = await pool.query(
      'SELECT is_banned FROM users WHERE discord_id = $1',
      [discordId]
    );
    if (rows[0]?.is_banned) return false; // silent fail for banned users
  } catch (err) {
    console.error('[middleware] ban check error:', err.message);
    await replyError(message, 'An internal error occurred. Please try again.');
    return false;
  }

  // ── 2. Registration check ────────────────────────────────────────────────
  let isRegistered = false;
  try {
    const { rows } = await pool.query(
      'SELECT 1 FROM users WHERE discord_id = $1',
      [discordId]
    );
    isRegistered = rows.length > 0;
  } catch (err) {
    console.error('[middleware] registration check error:', err.message);
    await replyError(message, 'An internal error occurred. Please try again.');
    return false;
  }

  if (!isRegistered) {
    await replyError(message, 'You are not registered. Use `crd register` to get started.');
    return false;
  }

  // ── 3. Character check (RPG commands only) ───────────────────────────────
  if (requiresCharacter) {
    try {
      const { rows } = await pool.query(
        'SELECT 1 FROM user_character WHERE discord_id = $1',
        [discordId]
      );
      if (rows.length === 0) {
        await replyError(message, 'You don\'t have a character yet. Use `crd create character` to get started.');
        return false;
      }
    } catch (err) {
      console.error('[middleware] character check error:', err.message);
      await replyError(message, 'An internal error occurred. Please try again.');
      return false;
    }
  }

  // ── 4. Bot-channel check ─────────────────────────────────────────────────
  if (guildId) {
    try {
      const { rows } = await pool.query(
        'SELECT bot_channel_id FROM server_config WHERE guild_id = $1',
        [guildId]
      );
      const botChannelId = rows[0]?.bot_channel_id ?? null;
      if (botChannelId && message.channel.id !== botChannelId) {
        await replyError(message, `Commands are restricted to <#${botChannelId}>.`);
        return false;
      }
    } catch {
      // if server_config row missing, no restriction — allow
    }
  }

  // ── 5. 10-second cooldown ─────────────────────────────────────────────────
  const now = Date.now();
  const last = cooldowns.get(discordId) ?? 0;
  const elapsed = now - last;
  if (elapsed < COOLDOWN_MS) {
    // Future expiry instant = last successful use + the 10s window (NOT "now", NOT start).
    // Discord relative timestamp counts down client-side — one message, no edits.
    const readyAt = Math.floor((last + COOLDOWN_MS) / 1000);
    await replyError(message, `You're on cooldown — ready <t:${readyAt}:R>.`);
    return false;
  }
  cooldowns.set(discordId, now);

  // ── 6. UPSERT user_guild_activity ─────────────────────────────────────────
  if (guildId) {
    pool.query(
      `INSERT INTO user_guild_activity (discord_id, guild_id, last_active)
       VALUES ($1, $2, NOW())
       ON CONFLICT (discord_id, guild_id) DO UPDATE SET last_active = NOW()`,
      [discordId, guildId]
    ).catch(err => console.error('[middleware] activity upsert error:', err.message));
  }

  return true;
}

module.exports = { runMiddleware, getPrefix, invalidatePrefixCache, isBanned, DEFAULT_PREFIX };
