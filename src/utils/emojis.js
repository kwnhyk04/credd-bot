'use strict';

/**
 * emojis.js — parses game_items.txt (project root) into a lookup so any item
 * icon can be used inline in text as <:name:id>.
 *
 * game_items.txt format (pipe-separated):
 *   Display Name | 'emoji_name' | 'emoji_id'
 *
 * Output guarantee: every function returns either a fully-formed
 * `<:name:id>` tag (name [a-z0-9_]{2,32}, id numeric) or the caller's
 * unicode fallback — NEVER a bare `:name:` shortcode or a partial tag.
 *
 * Usage:
 *   const { emoji, displayName, emojiForDisplay } = require('../utils/emojis');
 *   emoji('credux_coin')                  → '<:credux_coin:1514006578112757760>'
 *   displayName('iron_sword')             → 'Iron Sword'
 *   emojiForDisplay("Iron Sword", '⚔️')   → '<:iron_sword:…>' (fallback if unknown)
 *
 * Startup helpers (called from index.js ready):
 *   auditWeaponEmojis(pool)   — warn-block of weapon names that fall back
 *   reconcileEmojiIds(client) — warn-block of registry IDs missing from the
 *                               live application/guild emoji lists (stale IDs)
 */

const fs = require('fs');
const path = require('path');

// Registries live at the project root (this file is src/utils/).
// Both files share the format and load into ONE lookup (items + deities).
const REGISTRY_PATHS = [
  path.join(__dirname, '..', '..', 'game_items.txt'),
  path.join(__dirname, '..', '..', 'game_deities.txt'),
];

// Belief Shards lives in game_items.txt as `belief_shards`; keep this legacy
// export aligned for older callers, but prefer emoji('belief_shards') in new code.
const BELIEF_SHARDS_ICON = '<:belief_shards:1515278565112025128>';

// Explicit display-name → emoji-name overrides for stubborn mismatches
// (registry display names that diverge from the DB roster names).
const ALIASES = {
  "freyr's arrow": 'freyr_arrow',
  "initiate's blade": 'initiate_blade',
  // Registry display names that diverge from the roster names:
  'egyptian asa (tahtib)': 'egyptian_asa',         // registry drops the "(Tahtib)"
  "alan's reversed hands": 'alan_revered_hands',   // registry typo: "Revered"
  'knuckle charm anting-anting': 'knuckle_charm',  // registry shortens the name
};

const registry = new Map();     // emojiName → { id, display }
const displayIndex = new Map(); // normalized name (alnum-only) → emojiName

// Valid Discord custom-emoji parts — anything else falls back, never emitted.
const VALID_NAME = /^[a-z0-9_]{2,32}$/i;
const VALID_ID = /^\d+$/;

// Normalization: lowercase + strip ALL non-alphanumerics ("Iron Sword" → ironsword).
function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Possessive variant: per-word trailing 's (and bare s) removed BEFORE norm
// ("Initiate's Blade" → "initiate blade" → initiateblade).
function normPossessive(s) {
  return norm(s.toLowerCase().replace(/'s\b/g, '').replace(/s\b/g, ''));
}

function tag(name, id) {
  return VALID_NAME.test(name) && VALID_ID.test(id) ? `<:${name}:${id}>` : null;
}

function load() {
  if (registry.size) return;
  for (const file of REGISTRY_PATHS) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      console.warn(`[emojis] registry file missing, skipped: ${path.basename(file)}`);
      continue;
    }
    for (const line of raw.split('\n')) {
      const parts = line.split('|').map((s) => s.trim().replace(/^'|'$/g, ''));
      if (parts.length !== 3) continue;            // skips header + divider rows
      const [display, name, id] = parts;
      if (!VALID_ID.test(id)) continue;            // only rows with a numeric ID
      if (!VALID_NAME.test(name)) {                // malformed name → never emit it
        console.warn(`[emojis] skipping registry row with invalid emoji name: ${JSON.stringify(name)}`);
        continue;
      }
      registry.set(name, { id, display });
      // Index both the emoji name and the display name, plain + possessive-stripped.
      for (const key of [norm(name), norm(display), normPossessive(display)]) {
        if (key && !displayIndex.has(key)) displayIndex.set(key, name);
      }
    }
  }
}

/** Inline emoji string for text displays. Falls back to a generic icon if unknown. */
function emoji(name) {
  load();
  const e = registry.get(name);
  return (e && tag(name, e.id)) || '▫️';
}

/** Display name from emoji name (weapons list, etc.) */
function displayName(name) {
  load();
  return registry.get(name)?.display ?? name;
}

/** Resolve a display name to a registry emoji name (or null). Used by the audit too. */
function resolveName(display) {
  load();
  const alias = ALIASES[display.toLowerCase().trim()];
  if (alias && registry.has(alias)) return alias;
  return displayIndex.get(norm(display)) ?? displayIndex.get(normPossessive(display)) ?? null;
}

/**
 * Emoji for an in-game display name (e.g. a weapon_roster name). Alias map,
 * then normalized match (alnum-only, with and without possessive 's/s);
 * returns `fallback` when the item can't be resolved to a valid tag.
 */
function emojiForDisplay(display, fallback = '▫️') {
  const name = resolveName(display);
  if (!name) return fallback;
  return tag(name, registry.get(name).id) || fallback;
}

// ── Startup diagnostics ─────────────────────────────────────────────────────

/** Levenshtein distance — small inputs only (~90 registry rows). */
function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function nearestCandidate(display) {
  load();
  const target = norm(display);
  let best = null;
  let bestDist = Infinity;
  for (const [name, { display: d }] of registry.entries()) {
    const dist = Math.min(lev(target, norm(d)), lev(target, norm(name)));
    if (dist < bestDist) { bestDist = dist; best = name; }
  }
  // Only suggest plausibly-related candidates.
  return bestDist <= Math.max(3, Math.floor(target.length * 0.34)) ? best : null;
}

/**
 * Run every DISTINCT weapon AND deity name through the resolver; log ONE
 * warning block per roster listing the names that would fall back to a
 * generic emoji, with the nearest registry candidate where one plausibly exists.
 */
async function auditWeaponEmojis(pool) {
  for (const [label, sql] of [
    ['weapon', 'SELECT DISTINCT name FROM weapon_roster ORDER BY name'],
    ['deity', 'SELECT DISTINCT name FROM deity_roster ORDER BY name'],
  ]) {
    try {
      const { rows } = await pool.query(sql);
      const misses = rows
        .map((r) => r.name)
        .filter((n) => !resolveName(n))
        .map((n) => {
          const near = nearestCandidate(n);
          return `  - "${n}"${near ? `  (nearest registry entry: ${near})` : ''}`;
        });
      if (misses.length === 0) {
        console.log(`[emojis] ${label}-emoji audit: all ${label} names resolve.`);
      } else {
        console.warn(
          `[emojis] ${label}-emoji audit: ${misses.length} name(s) fall back to a generic emoji:\n${misses.join('\n')}`
        );
      }
    } catch (err) {
      console.warn(`[emojis] ${label}-emoji audit skipped:`, err.message);
    }
  }
}

/**
 * Reconcile registry IDs against the live emoji lists (application emojis +
 * every joined guild's emojis). A registry ID missing from both is unusable by
 * the bot — Discord renders the tag as literal text (deleted / re-uploaded).
 */
async function reconcileEmojiIds(client) {
  try {
    load();
    // Duplicate IDs inside the registries (copy-paste errors — two names, one emoji).
    const byId = new Map();
    for (const [name, { id }] of registry.entries()) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(name);
    }
    const dupes = [...byId.entries()].filter(([, names]) => names.length > 1);
    if (dupes.length > 0) {
      console.warn(
        `[emojis] registry has ${dupes.length} duplicated ID(s):\n` +
        dupes.map(([id, names]) => `  - id=${id} shared by: ${names.join(', ')}`).join('\n')
      );
    }
    const liveIds = new Set();
    const appEmojis = await client.application.emojis.fetch().catch(() => null);
    if (appEmojis) for (const e of appEmojis.values()) liveIds.add(e.id);
    for (const guild of client.guilds.cache.values()) {
      for (const e of guild.emojis.cache.values()) liveIds.add(e.id);
    }
    if (liveIds.size === 0) {
      console.warn('[emojis] ID reconcile skipped: no live emojis visible (app list empty, no guild emojis cached).');
      return;
    }
    const stale = [...registry.entries()].filter(([, { id }]) => !liveIds.has(id));
    if (stale.length === 0) {
      console.log(`[emojis] ID reconcile: all ${registry.size} registry IDs are live.`);
    } else {
      console.warn(
        `[emojis] ID reconcile: ${stale.length} registry ID(s) not found in app/guild emoji lists ` +
        `(deleted or re-uploaded — these render as literal text):\n` +
        stale.map(([name, { id, display }]) => `  - ${name} (${display}) id=${id}`).join('\n')
      );
    }
  } catch (err) {
    console.warn('[emojis] ID reconcile skipped:', err.message);
  }
}

module.exports = {
  emoji,
  displayName,
  emojiForDisplay,
  resolveName,
  auditWeaponEmojis,
  reconcileEmojiIds,
  BELIEF_SHARDS_ICON,
};
