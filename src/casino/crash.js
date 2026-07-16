'use strict';

/**
 * crash.js — pure crash SESSION core (Master §24). Push-your-luck.
 *
 * Each push: roll the crash chance FIRST (crashChance(push)); crash → lose the
 * already-debited bet, and the crash point shown is that push's multiplier; survive → lock
 * crashMultiplier(push) as the safe cash-out value. Crash chance is 20% at push 1 and +2%
 * each push (push2 22%, push3 24%…), capped at 75% (reached at push 29). Beyond push 6 the
 * multiplier extends per payoutTables (×1.45/push).
 *
 * PURE: owns no Map, no DB, no Discord; takes an injectable rng. The command layer owns the
 * per-user session Map, the Push/Cash Out buttons, the 60s auto-cash-out timer, and the
 * money path (bet debited up front; full payout credited on resolution).
 */

const { crashChance, crashMultiplier } = require('./payoutTables');
const { rng: defaultRng } = require('./rng');

/** Create a fresh crash session. Bet is debited up front by the command layer. */
function create(bet, rng = defaultRng) {
  return {
    bet,
    rng,
    push: 0,            // pushes SURVIVED so far
    multiplier: 1,      // current safe cash-out multiplier (1 before any survived push)
    state: 'active',    // 'active' | 'crashed' | 'cashed'
    crashPoint: null,   // multiplier shown when it collapses
    payout: 0,
  };
}

/** Attempt the next push. Returns { crashed, push, multiplier }. */
function pushNext(s) {
  if (s.state !== 'active') return { crashed: s.state === 'crashed', push: s.push, multiplier: s.multiplier };
  const n = s.push + 1;
  const chance = crashChance(n);
  if (s.rng.chance(chance)) {
    s.state = 'crashed';
    s.push = n;
    s.crashPoint = crashMultiplier(n);
    s.payout = 0;
    return { crashed: true, push: n, multiplier: s.crashPoint };
  }
  s.push = n;
  s.multiplier = crashMultiplier(n);
  return { crashed: false, push: n, multiplier: s.multiplier };
}

/** Cash out at the current safe multiplier. Returns the gross payout. */
function cashOut(s) {
  if (s.state !== 'active') return s.payout;
  s.state = 'cashed';
  s.payout = Math.floor(s.bet * s.multiplier);
  return s.payout;
}

module.exports = { create, pushNext, cashOut };
