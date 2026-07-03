'use strict';

const pool = require('../db/pool');
const { cooldownMs } = require('../config/cooldowns');

// In-memory cooldown store: "discord_id:commandKey" → timestamp of last use.
// Compound key gives each command its own independent window (per-user, across guilds).
// Window length is per-command; config currently resolves commands to 10s windows.
const cooldowns = new Map();

/**
 * Lightweight ban check by discord id. Returns true if the user IS banned.
 * Used by `crd register` (which skips the full pipeline) and by button interactions.
 * Fails CLOSED: on DB error, returns true (block) so a hiccup never lets a write through.
 */
async function isBanned(discordId) {
  try {
    const { rows } = await pool.query('SELECT is_banned FROM users WHERE discord_id = $1', [discordId]);
    return rows[0]?.is_banned === true;
  } catch (err) {
    console.error('[middleware] isBanned error:', err.message);
    return true;
  }
}

/** Plain-text middleware error (§27 — no embeds). Ephemeral on the slash path only. */
function mwError(ctx, text) {
  return ctx.reply({ content: text, ephemeral: ctx.isSlash }).catch(() => {});
}
function blockedSlash(ctx) {
  if (!ctx.isSlash) return Promise.resolve();
  const interaction = ctx.interaction;
  if (interaction?.replied || interaction?.deferred) return Promise.resolve();
  return mwError(ctx, 'You cannot use this bot.');
}

/**
 * Middleware pipeline — runs before every RPG/economy/casino/admin command, on BOTH the prefix
 * and slash paths (it consumes a CommandContext). Order (Blueprint §4):
 *   1. Ban check  2. Registration check  3. Character check (requiresCharacter)
 *   4. Per-command cooldown  5. UPSERT user_guild_activity
 * Returns true if the command should proceed, false if blocked.
 */
async function runMiddleware(ctx, { requiresCharacter = false, commandKey = '' } = {}) {
  const discordId = ctx.userId;
  const guildId = ctx.guildId;

  // ── 1–3. Ban / registration / character — ONE query (keeps the slash path
  // inside Discord's 3s pre-defer ack window even when the DB is slow).
  // Zero rows = not registered (an unregistered user can't be banned, so the
  // original ban-first ordering is preserved by construction).
  let gate;
  try {
    const { rows } = await pool.query(
      `SELECT u.is_banned, (uc.discord_id IS NOT NULL) AS has_character
         FROM users u
         LEFT JOIN user_character uc ON uc.discord_id = u.discord_id
        WHERE u.discord_id = $1`,
      [discordId]
    );
    gate = rows[0] || null;
  } catch (err) {
    console.error('[middleware] gate check error:', err.message);
    await mwError(ctx, 'An internal error occurred. Please try again.');
    return false;
  }
  if (gate?.is_banned) {
    await blockedSlash(ctx);
    return false;
  }
  if (!gate) {
    await mwError(ctx, 'You are not registered. Use `crd register` to get started.');
    return false;
  }
  if (requiresCharacter && !gate.has_character) {
    await mwError(ctx, 'You don\'t have a character yet. Use `crd create character` to get started.');
    return false;
  }

  // ── 4. Cooldown (per user PER COMMAND; window is per-command — [v4.8]) ─────
  const windowMs = cooldownMs(commandKey);
  const cooldownKey = `${discordId}:${commandKey}`;
  const now = Date.now();
  const last = cooldowns.get(cooldownKey) ?? 0;
  const elapsed = now - last;
  if (elapsed < windowMs) {
    const remainingMs = windowMs - elapsed;
    const readyAt = Math.floor((last + windowMs) / 1000); // SECONDS, future
    const sent = await ctx
      .reply({ content: `You're on cooldown — ready <t:${readyAt}:R>.`, ephemeral: ctx.isSlash })
      .catch(() => null);
    // Auto-delete the prefix notice when the cooldown ends (slash ephemerals can't be deleted here).
    if (sent && !ctx.isSlash && typeof sent.delete === 'function') {
      setTimeout(() => sent.delete().catch(() => {}), remainingMs);
    }
    return false;
  }
  cooldowns.set(cooldownKey, now);

  // ── 5. UPSERT user_guild_activity ─────────────────────────────────────────
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

module.exports = { runMiddleware, isBanned };
