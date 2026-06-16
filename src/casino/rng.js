'use strict';

/**
 * rng.js — the ONE randomness source for the entire casino (Phase 10).
 *
 * Casino fairness rule (non-negotiable): every draw uses crypto-backed entropy via
 * `crypto.randomInt`, NEVER `Math.random`. The self-test greps `src/casino/` for any
 * `Math.random` and fails the build if found.
 *
 * `makeRng(intFn)` wraps a primitive `intFn(n) -> integer in [0, n)` into the helper
 * surface the games use. The default export `rng` is crypto-backed; the self-test injects
 * a mock `intFn` (a controlled sequence) to force any face / hand / crash point and to run
 * large-N distribution checks. All engines accept an injectable rng for exactly this reason.
 *
 * `chance(pct)` resolves to 0.01% precision (int(10000) < pct*100) so whole-percent crash
 * odds (20/25/30/…) and the slot ladder (1/5/10/50/50) are exact.
 */

const crypto = require('crypto');

/** Wrap a uniform `intFn(n) -> [0, n)` into the rng helper surface. */
function makeRng(intFn) {
  const int = (n) => {
    if (!Number.isInteger(n) || n < 1) throw new RangeError(`rng.int needs n >= 1, got ${n}`);
    return intFn(n);
  };
  return {
    int,                                   // [0, n)
    range: (min, max) => min + int(max - min + 1), // inclusive [min, max]
    pick: (arr) => arr[int(arr.length)],
    // true with probability `pct` percent (0..100), 0.01% resolution
    chance: (pct) => int(10_000) < Math.round(pct * 100),
  };
}

/** Default crypto-backed rng — the only one the live bot ever uses. */
const rng = makeRng((n) => crypto.randomInt(n));

module.exports = { rng, makeRng };
