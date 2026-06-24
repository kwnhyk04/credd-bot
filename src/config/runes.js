'use strict';

/**
 * runes.js — Phase 2 rune/socket config (code-side constants).
 *
 * The DB seeds rune CONTENT (rune_roster, v5b §A) and the OPEN drop tables
 * (essence_bag_def.rune_pool). This module holds the code-side reconciliation:
 *   - rune-bag identity (open alias lb/gb/db ↔ lesser/greater/divine, stockpile
 *     column, display name, opening gif),
 *   - the `crd essence shop` catalog (6 buyable ids) + `crd exchange [id]`,
 *   - rune icon/art lookups,
 *   - unsocket Credux cost + rune sell payout (both tunable, Phase 6).
 *
 * All credux/essence amounts are first-pass — re-balance in the Phase 6 retune.
 */

const { emoji, emojiForDisplay } = require('../utils/emojis');

// Tier ladder shared with gear (rune_roster.tier uses the same five strings,
// though Common never seeds a rune).
const RUNE_TIERS = ['Rare', 'Mythic', 'Legendary', 'Supreme'];

// Effect keys → engine hook families (Naming Conv §2). Stat-% families feed the
// stat-assembly pipeline; effect families register as combat hooks.
const STAT_EFFECT_KEYS = ['sharpness', 'precision', 'vitality', 'bulwark'];
const COMBAT_EFFECT_KEYS = ['vampiric', 'piercing', 'venom', 'thorns', 'warding', 'aegis_rune'];
const OFFENSE_KEYS = ['sharpness', 'precision', 'vampiric', 'piercing', 'venom'];
const DEFENSE_KEYS = ['vitality', 'bulwark', 'thorns', 'warding', 'aegis_rune'];

// ── Rune bags (stockpiled; bought in essence shop, opened with lb/gb/db) ─────
// poolKey = essence_bag_def.bag_key (supplies the weighted rune_pool drop table).
const BAGS = {
  lesser:  { alias: 'lb', column: 'lesser_rune_bag',  display: 'Lesser Rune Bag',  gifKey: 'lesser_bag',  poolKey: 'lesser',  emojiName: 'lesser_bag' },
  greater: { alias: 'gb', column: 'greater_rune_bag', display: 'Greater Rune Bag', gifKey: 'greater_bag', poolKey: 'greater', emojiName: 'greater_bag' },
  divine:  { alias: 'db', column: 'divine_rune_bag',  display: 'Divine Rune Bag',  gifKey: 'divine_bag',  poolKey: 'divine',  emojiName: 'divine_bag' },
};
// open alias → bag key
const BAG_ALIAS = { lb: 'lesser', gb: 'greater', db: 'divine' };
const BAG_ALIASES = Object.keys(BAG_ALIAS);          // ['lb','gb','db']
const RUNE_BAG_MAX_OPEN = 10;

// ── Essence columns (users_bag) ──────────────────────────────────────────────
const ESSENCE_COLUMN = {
  epic: 'epic_essence', mythic: 'mythic_essence',
  legendary: 'legendary_essence', supreme: 'supreme_essence',
};

// ── Essence shop catalog — `crd essence shop` / `crd exchange [id]` (§2.7) ────
// One-way only (never downward). cost.essence/credux spent → grant.column +amount.
const ESSENCE_SHOP = [
  { id: 1, name: 'Lesser Rune Bag',  emojiName: 'lesser_rune_bag',
    cost: { essence: 'mythic',    amount: 10, credux: 10000 },  grant: { column: 'lesser_rune_bag',  amount: 1 } },
  { id: 2, name: 'Greater Rune Bag', emojiName: 'greater_rune_bag',
    cost: { essence: 'legendary', amount: 10, credux: 50000 },  grant: { column: 'greater_rune_bag', amount: 1 } },
  { id: 3, name: 'Divine Rune Bag',  emojiName: 'divine_rune_bag',
    cost: { essence: 'supreme',   amount: 10, credux: 100000 }, grant: { column: 'divine_rune_bag',  amount: 1 } },
  { id: 4, name: 'Mythic Essence',    emojiName: 'mythic_essence',
    cost: { essence: 'epic',      amount: 10, credux: 10000 },  grant: { column: 'mythic_essence',    amount: 1 } },
  { id: 5, name: 'Legendary Essence', emojiName: 'legendary_essence',
    cost: { essence: 'mythic',    amount: 10, credux: 50000 },  grant: { column: 'legendary_essence', amount: 1 } },
  { id: 6, name: 'Supreme Essence',   emojiName: 'supreme_essence',
    cost: { essence: 'legendary', amount: 10, credux: 100000 }, grant: { column: 'supreme_essence',   amount: 1 } },
];

// ── Unsocket cost (Credux; rune returned to bag) + rune sell payout — by tier ─
const UNSOCKET_COST = { Rare: 5000, Mythic: 15000, Legendary: 40000, Supreme: 100000 };
const RUNE_SELL_PRICE = { Rare: 2000, Mythic: 10000, Legendary: 40000, Supreme: 150000 };

// ── Icon / art helpers ───────────────────────────────────────────────────────
/** Registry emoji name for a rune effect_key (aegis_rune is already suffixed). */
function runeEmojiName(effectKey) {
  return effectKey === 'aegis_rune' ? 'aegis_rune' : `${effectKey}_rune`;
}
/** Inline emoji for a rune effect_key (falls back to the generic rune icon). */
function runeEmoji(effectKey) {
  const tag = emoji(runeEmojiName(effectKey));
  return tag === '▫️' ? emoji('rune_icon') : tag;
}
/** Inline emoji for a rune bag (custom lesser_bag/greater_bag/divine_bag; 📦 fallback). */
function bagEmoji(bagKey) {
  const tag = emoji(BAGS[bagKey].emojiName);
  return tag === '▫️' ? '📦' : tag;
}
/** Inline emoji for an essence/bag shop row by its registry name. */
function shopEmoji(emojiName) {
  const tag = emoji(emojiName);
  return tag === '▫️' ? '📦' : tag;
}
/** Rune art file path relative to the assets root (assets/items/runes/<key>.png). */
function runeArtRel(effectKey) {
  return `items/runes/${effectKey}.png`;
}

module.exports = {
  RUNE_TIERS,
  STAT_EFFECT_KEYS, COMBAT_EFFECT_KEYS, OFFENSE_KEYS, DEFENSE_KEYS,
  BAGS, BAG_ALIAS, BAG_ALIASES, RUNE_BAG_MAX_OPEN,
  ESSENCE_COLUMN, ESSENCE_SHOP,
  UNSOCKET_COST, RUNE_SELL_PRICE,
  runeEmojiName, runeEmoji, bagEmoji, shopEmoji, runeArtRel,
};
