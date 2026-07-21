'use strict';

/**
 * crdBagItems — the CRD Bag Items registry (Genesis update S7-S8).
 *
 * This is the ONLY resolution source for `crd use <id>`. Ids are unique
 * within this category; the same id existing in another category (shop
 * numeric ids, chest codes, rune-bag codes) is NOT a conflict and NOT usable.
 *
 * `column` = users_bag ownership column (whitelist — never interpolate
 * anything else). `use` names the effect handler in use.js.
 */

const CRD_BAG_ITEMS = Object.freeze([
  Object.freeze({ id: 'cc',   name: 'Character Class Change', emojiName: 'change_class',  column: 'change_class',   use: 'classChange' }),
  Object.freeze({ id: 'sr',   name: 'Sacred Relic',           emojiName: 'sacred_relic',  column: 'sacred_relics',  use: 'relicOpen' }),
  Object.freeze({ id: 'supr', name: 'Supreme Relic',          emojiName: 'supreme_relic', column: 'supreme_relics', use: 'relicOpen' }),
]);

/** Resolve a user-supplied id against the registry (case-insensitive). */
function resolveBagItem(id) {
  const key = String(id || '').trim().toLowerCase();
  return CRD_BAG_ITEMS.find((item) => item.id === key) || null;
}

// Ids that belong to OTHER categories — recognized only to give a precise
// rejection message (never usable through `crd use`).
const CHEST_IDS = Object.freeze(['sc', 'gc', 'btc', 'bgtc', 'supc', 'dmc', 'gnc']);
const RUNE_BAG_IDS = Object.freeze(['lb', 'gb', 'db']);

module.exports = { CRD_BAG_ITEMS, resolveBagItem, CHEST_IDS, RUNE_BAG_IDS };
