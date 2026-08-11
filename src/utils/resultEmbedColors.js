'use strict';

const { TIER_ALIAS, TIER_COLOR } = require('../config/gachaRates');

// These ladders intentionally remain separate.  Deity and rune results use
// the gacha tier set; chest results use the equipment tier set and include
// Genesis above Supreme.
const DEITY_TIER_RANK = Object.freeze({ Epic: 0, Mythic: 1, Legendary: 2, Supreme: 3 });
const RUNE_TIER_RANK = Object.freeze({ Epic: 0, Mythic: 1, Legendary: 2, Supreme: 3 });
const CHEST_TIER_RANK = Object.freeze({ Rare: 0, Mythic: 1, Legendary: 2, Supreme: 3, Genesis: 4 });

const DEITY_ALIAS_TO_TIER = Object.freeze(
  Object.fromEntries(Object.entries(TIER_ALIAS).map(([tier, alias]) => [alias, tier]))
);

// Chest Rare and Genesis do not exist in the deity gacha color table.  The
// shared colors below match the existing equipment-tier display colors.
const CHEST_TIER_COLOR = Object.freeze({
  Rare: 0x3498db,
  Mythic: TIER_COLOR.Mythic,
  Legendary: TIER_COLOR.Legendary,
  Supreme: TIER_COLOR.Supreme,
  Genesis: 0xffffff,
});

const RUNE_TIER_COLOR = Object.freeze({
  Epic: TIER_COLOR.Epic,
  Mythic: TIER_COLOR.Mythic,
  Legendary: TIER_COLOR.Legendary,
  Supreme: TIER_COLOR.Supreme,
});

function canonicalTier(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.toLowerCase() === 'mythical') return 'Mythic';
  return raw[0].toUpperCase() + raw.slice(1).toLowerCase();
}

function highestTierColor(items, { rank, colors, getTier, fallback }) {
  if (!Array.isArray(items)) return fallback;

  let highestRank = -1;
  let highestColor = fallback;
  for (const item of items) {
    const tier = canonicalTier(getTier(item));
    const currentRank = rank[tier];
    if (currentRank == null || currentRank <= highestRank) continue;
    highestRank = currentRank;
    highestColor = colors[tier] ?? fallback;
  }
  return highestColor;
}

function getDeityResultColor(results, fallback) {
  return highestTierColor(results, {
    rank: DEITY_TIER_RANK,
    colors: TIER_COLOR,
    // Summon rendering receives the display alias (`Remnant`, `Awakened`,
    // `Undying`, `Primordial`), while tests and future callers may provide the
    // underlying tier directly.
    getTier: (result) => DEITY_ALIAS_TO_TIER[result?.rarity] || result?.tier || result?.rarity,
    fallback,
  });
}

function getRuneResultColor(items, fallback) {
  return highestTierColor(items, {
    rank: RUNE_TIER_RANK,
    colors: RUNE_TIER_COLOR,
    getTier: (item) => item?.tier,
    fallback,
  });
}

function getChestResultColor(items, fallback) {
  return highestTierColor(items, {
    rank: CHEST_TIER_RANK,
    colors: CHEST_TIER_COLOR,
    getTier: (item) => item?.tier,
    fallback,
  });
}

module.exports = {
  DEITY_TIER_RANK,
  RUNE_TIER_RANK,
  CHEST_TIER_RANK,
  DEITY_ALIAS_TO_TIER,
  CHEST_TIER_COLOR,
  RUNE_TIER_COLOR,
  getDeityResultColor,
  getRuneResultColor,
  getChestResultColor,
};
