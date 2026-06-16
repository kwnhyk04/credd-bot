'use strict';

/**
 * diceRoll.js — pure two-dice engine (Master §24). Two INDEPENDENT d6 (equal per face);
 * total parity vs the player's odd/even pick → 2× (even money).
 *
 * Pure: (bet, pick, rng) -> outcome. No DB, no Discord, no Math.random.
 */

const { EVEN_MONEY } = require('./payoutTables');
const { rng: defaultRng } = require('./rng');

/** @param {'odd'|'even'} pick */
function play(bet, pick, rng = defaultRng) {
  const d1 = rng.range(1, 6);
  const d2 = rng.range(1, 6);
  const sum = d1 + d2;
  const parity = sum % 2 === 0 ? 'even' : 'odd';
  const win = parity === pick;
  return {
    game: 'dice_roll',
    d1,
    d2,
    sum,
    parity,
    pick,
    win,
    payout: win ? bet * EVEN_MONEY : 0,
  };
}

module.exports = { play };
