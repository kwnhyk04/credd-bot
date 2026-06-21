'use strict';

/**
 * skinEmojis.js — loads the skin → custom-emoji map from `skins.txt` at the repo root.
 * Format (pipe-delimited, one per line; a header line `name | 'emoji_name' | emoji_id` is skipped):
 *   Divine Radiance P1 | 'c_divine_radiance_p1' | 1517970020657922158
 *   Supporter Token    | 'supporter_token'      | 1518176293118541874
 *   Supporter Shop     | 'supporter_shop'       | 1518176290920726601
 *
 * Each row becomes a Discord custom-emoji string `<:emoji_name:emoji_id>`, keyed by:
 *   - the trailing skin code in the display name (P1/B2/R3/S1 → p1/b2/r3/s1), and
 *   - the emoji_name itself (so `supporter_token` / `supporter_shop` resolve directly).
 *
 * The file may be absent — the map is then empty and callers fall back to a neutral
 * per-category glyph (logged once). Returned values render inline in embeds.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'skins.txt');
// Fallback glyphs by catalog category (store skins carry real emoji; base/tester/founder don't).
const FALLBACK_BY_CATEGORY = { profile: '🖼️', battle: '⚔️', battle_result: '🏆', summon: '✨' };
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
      const cols = line.split('|').map((c) => c.trim());
      if (cols.length < 3) continue;
      const name = cols[0];
      const emojiName = cols[1].replace(/^'|'$/g, '').trim();
      const emojiId = cols[2].replace(/[^0-9]/g, '');
      if (!emojiName || !emojiId || name.toLowerCase() === 'name') continue; // skip header
      const emoji = `<:${emojiName}:${emojiId}>`;
      MAP[emojiName.toLowerCase()] = emoji;
      const codeMatch = /\b([pbrs]\d+)\s*$/i.exec(name);
      if (codeMatch) MAP[codeMatch[1].toLowerCase()] = emoji;
    }
    console.log(`[skinEmojis] loaded ${Object.keys(MAP).length} emoji keys from skins.txt`);
  } catch (err) {
    console.warn(`[skinEmojis] skins.txt not loaded (${err.code || err.message}); using fallback icons`);
  }
  return MAP;
}

/**
 * Emoji for a skin row. Resolves by skin_code first, then falls back to a neutral glyph
 * for the given category (base/tester/founder skins have no custom emoji of their own).
 */
function skinEmojiByCode(code, category) {
  const m = load();
  const key = String(code || '').toLowerCase();
  if (m[key]) return m[key];
  return FALLBACK_BY_CATEGORY[category] || FALLBACK_BY_LETTER[key.charAt(0)] || '🎨';
}

function iconToken() { return load().supporter_token || '🎟️'; }
function iconShop() { return load().supporter_shop || '🛒'; }
function iconSkins() { return '🎨'; } // collection palette (no dedicated emoji in skins.txt)

module.exports = { skinEmojiByCode, iconToken, iconShop, iconSkins };
