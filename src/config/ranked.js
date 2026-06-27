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
 * Eligible-opponent rating window spanning `span` brackets on each side
 * (Blueprint §4.3A default span=1 — prev/current/next bracket). Phase 6 widens to
 * span=2 when the ±1 pool is empty (or only the just-fought opponent remains).
 */
function matchRangeWide(rating, span = 1) {
  const idx = bracketIndex(bracketOf(rating).name);
  const lo = BRACKETS[Math.max(0, idx - span)].floor;
  const hiCeil = BRACKETS[Math.min(BRACKETS.length - 1, idx + span)].ceil;
  const hi = hiCeil === Infinity ? 1_000_000_000 : hiCeil;
  return { lo, hi };
}

/** Default ±1-bracket window (back-compat name). */
function matchRange(rating) {
  return matchRangeWide(rating, 1);
}

// Phase 6 dynamic tuning. The TIER difference (opponent bracket − self bracket)
// picks the reward BAND; win-expectancy positions the result WITHIN that band
// (a harder opponent lands nearer the top of the band, an easier one nearer the
// bottom). SCALE controls how fast expectancy saturates across the rating span.
const ELO_SCALE = 1000;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Win expectancy of `selfRating` vs `oppRating` (logistic, 0..1). */
function expectedScore(selfRating, oppRating) {
  return 1 / (1 + 10 ** ((Number(oppRating) - Number(selfRating)) / ELO_SCALE));
}

/** Tier difference: >0 opponent is a higher bracket, <0 lower, 0 same. */
function tierDiff(selfRating, oppRating) {
  return bracketIndex(bracketOf(oppRating).name) - bracketIndex(bracketOf(selfRating).name);
}

/**
 * DYNAMIC rating delta from the challenger's POV (Phase 6). Tier-difference bands,
 * positioned within the band by win-expectancy:
 *   WIN  — same tier 25..30 · higher tier 30..40 · lower tier 10..20
 *   LOSS — same −20..−25 · lost to higher −8..−15 · lost to lower −30..−40
 * (Losing to a weaker opponent — where you were favored — costs the most.)
 */
function eloDelta(selfRating, oppRating, won) {
  const e = expectedScore(selfRating, oppRating);
  const diff = tierDiff(selfRating, oppRating);
  if (won) {
    const [lo, hi] = diff > 0 ? [30, 40] : diff < 0 ? [10, 20] : [25, 30];
    return Math.round(lo + clamp01(1 - e) * (hi - lo)); // harder → top of band
  }
  const [lo, hi] = diff > 0 ? [8, 15] : diff < 0 ? [30, 40] : [20, 25];
  return -Math.round(lo + clamp01(e) * (hi - lo));        // were favored → bigger loss
}

/** Back-compat shim — old callers get the dynamic delta. */
function pointsFor(challengerRating, opponentRating, won) {
  return eloDelta(challengerRating, opponentRating, won);
}

/**
 * Valor Medals for a ranked result (Phase 6, tier-banded). Reduced vs the first cut:
 *   WIN  — higher tier 15..20 · same/lower 10..15
 *   LOSS — lost to higher 5..8 · same/lower 3..5
 * Position within band by expectancy (harder = top of band).
 */
function valorForResult(selfRating, oppRating, won) {
  const e = expectedScore(selfRating, oppRating);
  const diff = tierDiff(selfRating, oppRating);
  if (won) {
    const [lo, hi] = diff > 0 ? [15, 20] : [10, 15];
    return Math.round(lo + clamp01(1 - e) * (hi - lo));
  }
  const [lo, hi] = diff > 0 ? [5, 8] : [3, 5];
  return Math.round(lo + clamp01(1 - e) * (hi - lo));
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
  matchRangeWide,
  expectedScore,
  eloDelta,
  pointsFor,
  valorForResult,
  phtWeek,
};
