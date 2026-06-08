'use strict';

/**
 * Weapon sell prices + bulk-sell rules (Master §22).
 * Fixed Credux refund per weapon, by tier. Permanent deletion — see sell.js.
 */

// Fixed sell price (Credux) per weapon, by tier (§22).
const SELL_PRICES = {
  Common: 100,
  Rare: 1000,
  Mythic: 5000,
  Legendary: 100000,
  Supreme: 1000000,
};

// Valid `crd sell <tier>` targets. Per Master §22 every tier is a valid bulk
// tier-sell (Legendary/Supreme included); only `crd sell all` excludes the top
// two tiers. The Confirm dialog is the safeguard.
const TIER_NAMES = ['Common', 'Rare', 'Mythic', 'Legendary', 'Supreme'];

// alias (lowercased command arg) → canonical tier name.
const TIER_ALIASES = {
  common: 'Common',
  rare: 'Rare',
  mythic: 'Mythic',
  legendary: 'Legendary',
  supreme: 'Supreme',
};

// `crd sell all` excludes these tiers entirely (id-only, §22).
const ALL_EXCLUDED_TIERS = ['Legendary', 'Supreme'];

module.exports = {
  SELL_PRICES,
  TIER_NAMES,
  TIER_ALIASES,
  ALL_EXCLUDED_TIERS,
};
