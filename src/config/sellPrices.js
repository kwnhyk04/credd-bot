'use strict';

/**
 * Gear sell prices + bulk-sell rules (Master §22).
 * The base refund varies by tier. Enhanced gear additionally returns 30% of
 * the canonical costs of the levels it successfully reached; failed attempts
 * and actual historical spend are intentionally excluded.
 */

const { successfulEnhancementCost } = require('../engine/enhancement');

// Base sell price (Credux) per gear item, by tier (§22).
const SELL_PRICES = {
  Common: 100,
  Rare: 1000,
  Mythic: 50000,
  Legendary: 100000,
  Supreme: 1000000,
};

const ENHANCEMENT_SELL_REFUND_RATE = 0.30;

function sellPriceBreakdown(tier, enhancement) {
  const basePrice = SELL_PRICES[tier] || 0;
  const successfulCost = successfulEnhancementCost(tier, enhancement);
  const enhancementRefund = Math.floor(successfulCost * ENHANCEMENT_SELL_REFUND_RATE);
  return {
    basePrice,
    successfulCost,
    enhancementRefund,
    total: basePrice + enhancementRefund,
  };
}

function computeSellPrice(tier, enhancement) {
  return sellPriceBreakdown(tier, enhancement).total;
}

function computeSellTotal(rows) {
  return rows.reduce(
    (total, row) => total + computeSellPrice(row.tier, row.enhancement),
    0,
  );
}

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
  ENHANCEMENT_SELL_REFUND_RATE,
  sellPriceBreakdown,
  computeSellPrice,
  computeSellTotal,
  TIER_NAMES,
  TIER_ALIASES,
  ALL_EXCLUDED_TIERS,
};
