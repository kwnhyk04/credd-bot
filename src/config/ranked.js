'use strict';

/**
 * Ranked PvP config (v5 Phase 4 — Blueprint §4.2).
 * Elo brackets, point tables, matchmaking range, and PHT week helpers.
 */

// Blueprint Phase 4 bracket cutoffs (default rating 1000 = Champion floor).
const BRACKETS = [
  { name: 'Mortal',    floor: 0,     ceil: 999 },
  { name: 'Champion',  floor: 1000,  ceil: 2499 },
  { name: 'Demigod',   floor: 2500,  ceil: 4999 },
  { name: 'Ascendant', floor: 5000,  ceil: 9999 },
  { name: 'Divine',    floor: 10000, ceil: Infinity },
];

const WEEKLY_MIN_GAMES = 5;

/** Bracket object for a rating. */
function bracketOf(rating) {
  const r = Number(rating) || 0;
  for (const b of BRACKETS) if (r >= b.floor && r <= b.ceil) return b;
  return BRACKETS[0];
}

function bracketIndex(name) {
  return BRACKETS.findIndex((b) => b.name === name);
}

function bracketFloor(name) {
  const b = BRACKETS.find((x) => x.name === name);
  return b ? b.floor : 0;
}

/**
 * Eligible-opponent rating window: previous-bracket floor .. next-bracket ceil
 * (Blueprint §4.3A — match only prev/current/next bracket).
 */
function matchRange(rating) {
  const idx = bracketIndex(bracketOf(rating).name);
  const lo = BRACKETS[Math.max(0, idx - 1)].floor;
  const hiCeil = BRACKETS[Math.min(BRACKETS.length - 1, idx + 1)].ceil;
  const hi = hiCeil === Infinity ? 1_000_000_000 : hiCeil;
  return { lo, hi };
}

/**
 * Rating delta from the challenger's POV (Blueprint §4.2 point table):
 *   opponent in SAME bracket  → win +25, loss −20
 *   opponent BELOW (lower)     → win +12, loss −35
 *   opponent ABOVE (higher)    → win +40, loss −10
 */
function pointsFor(challengerRating, opponentRating, won) {
  const cIdx = bracketIndex(bracketOf(challengerRating).name);
  const oIdx = bracketIndex(bracketOf(opponentRating).name);
  if (oIdx === cIdx) return won ? 25 : -20;
  if (oIdx < cIdx)   return won ? 12 : -35; // beat/lose-to a lower bracket
  return won ? 40 : -10;                    // beat/lose-to a higher bracket
}

/**
 * PHT ISO week number (year*100 + week) — stable weekly bucket for the claim
 * dedupe and the games-this-week count. Anchored to Asia/Manila.
 */
function phtWeek(date = new Date()) {
  // Shift to PHT (UTC+8), then compute ISO week on that wall-clock date.
  const pht = new Date(date.getTime() + 8 * 3600 * 1000);
  const d = new Date(Date.UTC(pht.getUTCFullYear(), pht.getUTCMonth(), pht.getUTCDate()));
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return d.getUTCFullYear() * 100 + week;
}

module.exports = {
  BRACKETS,
  WEEKLY_MIN_GAMES,
  bracketOf,
  bracketIndex,
  bracketFloor,
  matchRange,
  pointsFor,
  phtWeek,
};
