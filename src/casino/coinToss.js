'use strict';

/**
 * coinToss.js — pure coin-toss engine (Master §24). True 50/50.
 * Heads = Aeternvm, Tails = Obscvrvm. Match → 2× (even money).
 *
 * Pure: (bet, pick, rng) -> outcome. No DB, no Discord, no Math.random.
 */

const { EVEN_MONEY } = require('./payoutTables');
const { rng: defaultRng } = require('./rng');

const FACES = ['heads', 'tails'];
const FACE_NAME = { heads: 'Aeternvm', tails: 'Obscvrvm' };

/** @param {'heads'|'tails'} pick */
function play(bet, pick, rng = defaultRng) {
  const result = rng.pick(FACES);
  const win = result === pick;
  return {
    game: 'coin_toss',
    result,
    faceName: FACE_NAME[result],
    pick,
    win,
    payout: win ? bet * EVEN_MONEY : 0,
  };
}

module.exports = { play, FACES, FACE_NAME };
