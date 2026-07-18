'use strict';

/**
 * blackjack.js — pure blackjack SESSION core (Master §24). User vs dealer.
 *
 * Deal 2 to player, 2 to dealer (one face-down). Player Hit/Stand. Ace = 1 or 11 (best).
 * Dealer reveals on stand and hits until 17 (STANDS on soft 17). Bust = immediate loss.
 * Natural 21 pays normal 2× (no 3:2 bonus — the all-wins-100% rule). Tie = push (stake
 * returned).
 *
 * This module is PURE: it owns no Map, touches no DB and no Discord, and takes an injectable
 * rng. The command layer owns the per-user session Map, the buttons, the 60s timer, and the
 * money path. `payout` is GROSS returned (2×bet win, bet push, 0 loss).
 */

const {
  newDeck, blackjackValue, isBlackjack,
} = require('./cardDeck');
const { EVEN_MONEY } = require('./payoutTables');
const { rng: defaultRng } = require('./rng');

const DEALER_STANDS_AT = 17;

/** Create a fresh session with the opening deal. state: 'player' until Hit/Stand resolves. */
function create(bet, rng = defaultRng) {
  // [v4.7] one 52-card deck per round on the session, dealt without replacement (no duplicate
  // suit+rank across player + dealer hits this hand).
  const deck = newDeck(rng);
  const s = {
    bet,
    deck,
    player: [deck.draw(), deck.draw()],
    dealer: [deck.draw(), deck.draw()], // dealer[1] is the hole card (hidden)
    state: 'player',          // 'player' | 'done'
    outcome: null,            // 'win' | 'loss' | 'push'
    payout: 0,
    revealed: false,
  };
  // A natural on the deal resolves immediately (dealer also checks for 21).
  if (isBlackjack(s.player) || isBlackjack(s.dealer)) finish(s);
  return s;
}

function playerValue(s) { return blackjackValue(s.player); }
function dealerValue(s) { return blackjackValue(s.dealer); }

/** Player hits. Returns the session. Auto-resolves on bust. */
function hit(s) {
  if (s.state !== 'player') return s;
  s.player.push(s.deck.draw());
  if (blackjackValue(s.player) >= 21) finish(s); // 21 auto-stands; >21 busts
  return s;
}

/** Player stands → dealer plays out → resolve. */
function stand(s) {
  if (s.state !== 'player') return s;
  finish(s);
  return s;
}

/** Reveal the hole card, run the dealer to its threshold, and settle. */
function finish(s) {
  s.revealed = true;
  const pv = blackjackValue(s.player);
  // Opening naturals settle from the original four cards. In particular, the dealer
  // must not draw against a player's natural 21 and manufacture an invalid push.
  const openingNatural = isBlackjack(s.player) || isBlackjack(s.dealer);
  if (pv <= 21 && !openingNatural) {
    while (blackjackValue(s.dealer) < DEALER_STANDS_AT) s.dealer.push(s.deck.draw());
  }
  const dv = blackjackValue(s.dealer);

  let outcome;
  if (pv > 21) outcome = 'loss';
  else if (dv > 21) outcome = 'win';
  else if (pv > dv) outcome = 'win';
  else if (pv < dv) outcome = 'loss';
  else outcome = 'push';

  s.state = 'done';
  s.outcome = outcome;
  s.payout = outcome === 'win' ? s.bet * EVEN_MONEY : outcome === 'push' ? s.bet : 0;
}

module.exports = { create, hit, stand, playerValue, dealerValue, DEALER_STANDS_AT };
