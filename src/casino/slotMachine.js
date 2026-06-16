'use strict';

/**
 * slotMachine.js — pure 3-reel slot engine (Master §24).
 *
 * Highest-prize-first probability ladder; each rung is an INDEPENDENT crypto roll at its
 * own probability and the FIRST hit wins and stops:
 *   Wings 1% → ×20 · Trident 5% → ×10 · Skull 10% → ×5 · Lightning 30% → ×2 · Horus 30% → ×1.5 [v4.7]
 * Miss every rung → LOSE: a non-winning combo that is GUARANTEED not three-of-a-kind
 * (generated, then asserted).
 *
 * On a win all three reels show the SAME face. Multipliers can be fractional (×1.5), so the
 * gross payout is floored: `payout = floor(bet × mult)`.
 *
 * Pure: (bet, rng) -> outcome. No DB, no Discord, no Math.random.
 */

const { SLOT_FACES, SLOT_LADDER } = require('./payoutTables');
const { rng: defaultRng } = require('./rng');

/** A losing 3-reel combo that is never three-of-a-kind. */
function loseReels(rng) {
  let reels;
  do {
    reels = [rng.pick(SLOT_FACES), rng.pick(SLOT_FACES), rng.pick(SLOT_FACES)];
  } while (reels[0] === reels[1] && reels[1] === reels[2]);
  return reels;
}

function play(bet, rng = defaultRng) {
  for (const rung of SLOT_LADDER) {
    if (rng.chance(rung.prob)) {
      return {
        game: 'slot_machine',
        reels: [rung.face, rung.face, rung.face],
        win: true,
        face: rung.face,
        mult: rung.mult,
        payout: Math.floor(bet * rung.mult),
      };
    }
  }
  const reels = loseReels(rng);
  // Fairness invariant: the lose branch must never emit three-of-a-kind.
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    throw new Error('slotMachine: lose branch produced three-of-a-kind');
  }
  return { game: 'slot_machine', reels, win: false, face: null, mult: 0, payout: 0 };
}

module.exports = { play, loseReels };
