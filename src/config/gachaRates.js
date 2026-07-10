'use strict';

const { BELIEVER_EXP_PER_LEVEL } = require('./believerProgression');

/**
 * Deity gacha constants (Master §4 / §9 / §35.6). Hardcoded game-balance
 * values — no schema/seed. Authoritative source: Master §4 "Deity Drop Rates
 * [REVISED]" + "Deity Gacha Pity".
 */

// ── Tier roll weights (Ascension Patch §3.2) ───────────────────────────────
// Epic 64.5% · Mythic 34.4% · Legendary 1% · Supreme 0.1% — must sum to 1.0.
// (Was 64.5/30/5/0.5; the Ascension patch shifts Legendary/Supreme weight to
// Mythic — deity power now comes from Sigils, not raw pull luck.)
const TIER_WEIGHTS = [
  ['Epic', 0.645],
  ['Mythic', 0.344],
  ['Legendary', 0.01],
  ['Supreme', 0.001],
];

// ── Pity (Master §4 "Deity Gacha Pity" + §35.0) ────────────────────────────
// pity_count increments per natural roll; at 500 a Legendary is forced.
// Resets to 0 only when a Legendary OR Supreme is ROLLED (natural), or when the
// 500-threshold forces a Legendary. A relic-forced Supreme does NOT touch pity.
const PITY_THRESHOLD = 500;

// ── Cost / batch sizing (Master §4, lines 74–77) ───────────────────────────
const SHARDS_PER_PULL = 100;
const ALLOWED_SUMMON_COUNTS = Array.from({ length: 30 }, (_, i) => i + 1);
const MAX_PULLS = 30;

// ── Duplicate → tier essence (Blueprint line 266; Master §35.0 line 1957) ──
// Epic duplicates grant +1 essence; Mythic +2; Legendary +5; Supreme +10.
const ESSENCE_PER_DUPLICATE = Object.freeze({
  Epic: 1,
  Mythic: 2,
  Legendary: 5,
  Supreme: 10,
});
const TIER_ESSENCE_COLUMN = {
  Epic: 'epic_essence',
  Mythic: 'mythic_essence',
  Legendary: 'legendary_essence',
  Supreme: 'supreme_essence',
};

// ── Display (Master §9 deity tiers, lines 463–468) ─────────────────────────
const TIER_ALIAS = {
  Epic: 'Remnant',
  Mythic: 'Awakened',
  Legendary: 'Undying',
  Supreme: 'Primordial',
};
const TIER_COLOR = {
  Epic: 0x5865F2,      // Blue
  Mythic: 0x9b59b6,    // Purple
  Legendary: 0xFFD700, // Gold
  Supreme: 0xe74c3c,   // Red
};
const TIER_RANK = { Epic: 0, Mythic: 1, Legendary: 2, Supreme: 3 };

// ── Reputation (Master §18, lines 1069–1082) ───────────────────────────────
const REPUTATION_PER_PULL = 10;    // crd summon, per pull
const REP_DAILY_CAP = 1500;        // reputation EXP per day (PHT)

/**
 * Resolve one natural roll against the player's running pity counter.
 * Returns { tier, newPity, pityReset } where pityReset marks a roll that
 * should clear pity (natural Leg/Supreme, or the 500-forced Legendary).
 *
 * Per-roll rule (Master §4):
 *   1. Natural weighted roll (TIER_WEIGHTS).
 *   2. Natural Legendary/Supreme  → keep it, pity → 0 (reset).
 *   3. Else (Epic/Mythic)         → pity += 1; if it reaches 500, force
 *      Legendary and reset to 0; otherwise keep the natural tier + new pity.
 */
function resolveRoll(pity) {
  const natural = rollTier();
  if (natural === 'Legendary' || natural === 'Supreme') {
    return { tier: natural, newPity: 0, pityReset: true };
  }
  const incremented = pity + 1;
  if (incremented >= PITY_THRESHOLD) {
    return { tier: 'Legendary', newPity: 0, pityReset: true };
  }
  return { tier: natural, newPity: incremented, pityReset: false };
}

/** Weighted tier roll via cumulative walk. */
function rollTier() {
  const r = Math.random();
  let acc = 0;
  for (const [tier, p] of TIER_WEIGHTS) {
    acc += p;
    if (r < acc) return tier;
  }
  return TIER_WEIGHTS[TIER_WEIGHTS.length - 1][0]; // FP safety net
}

module.exports = {
  TIER_WEIGHTS,
  PITY_THRESHOLD,
  SHARDS_PER_PULL,
  ALLOWED_SUMMON_COUNTS,
  MAX_PULLS,
  ESSENCE_PER_DUPLICATE,
  TIER_ESSENCE_COLUMN,
  TIER_ALIAS,
  TIER_COLOR,
  TIER_RANK,
  REPUTATION_PER_PULL,
  REP_DAILY_CAP,
  BELIEVER_EXP_PER_LEVEL,
  rollTier,
  resolveRoll,
};
