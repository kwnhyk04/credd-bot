'use strict';

/**
 * payoutTables.js — SINGLE SOURCE OF TRUTH for every casino multiplier and bet limit
 * (Master §24 [v4.5]). No multiplier or limit literal lives anywhere else in the casino.
 *
 * Virtual-economy rule: ALL wins pay 100% of the stated multiplier — no house edge, no
 * baccarat commission, no real-payout shaving. `payout` is always the GROSS returned to
 * the player (stake included); net profit on a win is `payout - bet`.
 *
 * Max bets: 150,000 for every game EXCEPT crash = 25,000.
 */

const MAX_BET_DEFAULT = 150_000;
const MAX_BET_CRASH   = 25_000;

/** Even-money games: a win returns 2× the stake. */
const EVEN_MONEY = 2;

/**
 * Slot ladder — highest-prize-first probability rungs (Master §24). Each rung is an
 * INDEPENDENT crypto roll at its own probability; the first hit wins and stops. Miss every
 * rung → a non-winning combo (never three-of-a-kind). Faces map to reel asset indices.
 */
const SLOT_FACE_INDEX = { horus: 1, lightning: 2, skull: 3, trident: 4, wings: 5 };
const SLOT_FACES = ['horus', 'lightning', 'skull', 'trident', 'wings'];
const SLOT_LADDER = [
  { face: 'wings',     prob: 1,  mult: 20 },
  { face: 'trident',   prob: 5,  mult: 10 },
  { face: 'skull',     prob: 10, mult: 5 },
  { face: 'lightning', prob: 30, mult: 2 },   // [v4.7] was 50%
  { face: 'horus',     prob: 30, mult: 1.5 }, // [v4.7] was 50%
];

/**
 * Crash progression (Master §24). Rows 1–6 are LOCKED published values used verbatim.
 * Beyond push 6 the curve EXTENDS:
 *   crash chance = min(75, 15 + 5·push)   → push7 50%, push8 55%, … capped at 75%
 *   cash-out mult = round2( 9.28 · 1.45^(push-6) )  → push7 ≈13.46×, push8 ≈19.52×, …
 * The ×1.45 geometric step reproduces the published rows; rows 1–6 are returned exactly.
 */
const CRASH_MULT_TABLE = { 1: 1.45, 2: 2.10, 3: 3.05, 4: 4.42, 5: 6.40, 6: 9.28 };
const CRASH_STEP = 1.45;

/** Crash chance (%) rolled when ATTEMPTING the given push number. */
function crashChance(push) {
  return Math.min(75, 15 + 5 * push);
}

/** Cash-out multiplier locked in by SURVIVING the given push number. */
function crashMultiplier(push) {
  if (push <= 0) return 1;
  if (CRASH_MULT_TABLE[push] != null) return CRASH_MULT_TABLE[push];
  const extended = CRASH_MULT_TABLE[6] * Math.pow(CRASH_STEP, push - 6);
  return Math.round(extended * 100) / 100;
}

/** Max bet for a game key (crash is the only exception). */
function maxBet(game) {
  return game === 'crash' ? MAX_BET_CRASH : MAX_BET_DEFAULT;
}

module.exports = {
  MAX_BET_DEFAULT,
  MAX_BET_CRASH,
  EVEN_MONEY,
  SLOT_FACES,
  SLOT_FACE_INDEX,
  SLOT_LADDER,
  CRASH_MULT_TABLE,
  CRASH_STEP,
  crashChance,
  crashMultiplier,
  maxBet,
};
