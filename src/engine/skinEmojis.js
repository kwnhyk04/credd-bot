'use strict';

/**
 * skinEmojis.js — loads the skin → custom-emoji map from `skins.txt` at the repo root
 * (Supporter-stage addendum2 §0). Format: one `key=<emoji>` per line, where key is a
 * skin_code (p1/b2/r3/s2) or a special icon name (`token`, `skins`), e.g.
 *   p1=<:champions_arena:123456789012345678>
 *   token=<:supporter_token:123456789012345678>
 *   skins=<:skin_collection:123456789012345678>
 *
 * The file may be absent (it wasn't shipped with the addendum) — in that case the map is
 * empty and callers fall back to a neutral per-category emoji, logged once. Returned values
 * are full emoji strings rendered inline in embeds.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'skins.txt');
const FALLBACK_BY_LETTER = { p: '🖼️', b: '⚔️', r: '🏆', s: '✨' };

let MAP = null;
function load() {
  if (MAP) return MAP;
  MAP = {};
  try {
    const txt = fs.readFileSync(FILE, 'utf8');
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      const key = line.slice(0, i).trim().toLowerCase();
      const val = line.slice(i + 1).trim();
      if (key && val) MAP[key] = val;
    }
    console.log(`[skinEmojis] loaded ${Object.keys(MAP).length} emoji from skins.txt`);
  } catch (err) {
    console.warn(`[skinEmojis] skins.txt not loaded (${err.code || err.message}); using fallback icons`);
  }
  return MAP;
}

/** Emoji for a skin_code; falls back to a neutral per-category glyph (and logs the miss once). */
const missed = new Set();
function skinEmojiByCode(code) {
  const m = load();
  const key = String(code || '').toLowerCase();
  if (m[key]) return m[key];
  if (key && !missed.has(key)) { missed.add(key); console.warn(`[skinEmojis] no emoji for code "${key}" — fallback`); }
  return FALLBACK_BY_LETTER[key.charAt(0)] || '🎨';
}

function iconToken() { return load().token || '🎟️'; }
function iconSkins() { return load().skins || '🎨'; }

module.exports = { skinEmojiByCode, iconToken, iconSkins };
