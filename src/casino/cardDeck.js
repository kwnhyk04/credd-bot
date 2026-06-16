'use strict';

/**
 * cardDeck.js — 52-card model + asset-filename resolver for baccarat & blackjack.
 *
 * Suits ([v4.6] → standard): Pegasus=Clubs, Trident=Spades, Laurel=Hearts, Hammer=Diamonds.
 * Card assets are STATIC PNGs at `assets/casino/cards/img/{suit}_{rank}.png` (e.g.
 * `pegasus_a.png`, `trident_10.png`, `laurel_j.png`, `hammer_k.png`); the dealer's hole card is
 * `card_back.png`. Cards no longer animate.
 *
 * Draws are independent and uniform across 13 ranks × 4 suits (an infinite shoe) — this is
 * what the fairness spec asks for ("uniform across 13 ranks × 4 suits") and keeps the rank
 * and suit distributions perfectly flat. Point systems:
 *   - baccarat: A=1, 2–9 pip, 10/J/Q/K=0; score = Σ mod 10.
 *   - blackjack: A=1 or 11 (best), 2–10 pip, J/Q/K=10.
 */

const SUITS = ['pegasus', 'trident', 'laurel', 'hammer'];
const RANKS = ['a', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'j', 'q', 'k'];

// Display names: title-cased slugs (first letters P/T/L/H stay unique for the hand label).
const SUIT_LABEL = { pegasus: 'Pegasus', trident: 'Trident', laurel: 'Laurel', hammer: 'Hammer' };
const BACK_FILE = 'card_back.png';

/** Draw one independent uniform card { suit, rank } (with replacement — distribution sampling). */
function drawCard(rng) {
  return { suit: rng.pick(SUITS), rank: rng.pick(RANKS) };
}

/**
 * A single 52-card deck for ONE round/hand, dealt WITHOUT replacement ([v4.7] fix: a hand can
 * never hold the exact same suit+rank twice — the old per-card independent draw could produce
 * duplicates like two Hammer 6s). Build the full 52 (13 ranks × 4 suits) in canonical order, then
 * `draw()` does a uniform pick-then-remove, so each draw stays flat over the cards still in the
 * deck and rank/suit distributions remain even. A baccarat hand (≤6 cards) or a blackjack hand
 * never exhausts 52, so single-deck-per-round is the simplest correct model.
 */
function newDeck(rng) {
  const cards = [];
  for (const suit of SUITS) for (const rank of RANKS) cards.push({ suit, rank });
  return {
    /** Deal one card, removing it from the deck so it can't be dealt again this round. */
    draw() {
      if (cards.length === 0) throw new Error('cardDeck: deck exhausted');
      return cards.splice(rng.int(cards.length), 1)[0];
    },
    /** Cards remaining in the deck. */
    remaining() { return cards.length; },
  };
}

/** Baccarat point value (A=1, 2–9 pip, 10/J/Q/K=0). */
function baccaratValue(rank) {
  if (rank === 'a') return 1;
  if (rank === 'j' || rank === 'q' || rank === 'k' || rank === '10') return 0;
  return Number(rank);
}

/** Baccarat hand score (Σ values mod 10). */
function baccaratScore(hand) {
  return hand.reduce((s, c) => s + baccaratValue(c.rank), 0) % 10;
}

/** Blackjack pip value for a rank (Ace returned as 1; soft-ace handled in handValue). */
function blackjackPip(rank) {
  if (rank === 'a') return 1;
  if (rank === 'j' || rank === 'q' || rank === 'k') return 10;
  return Number(rank);
}

/** Best blackjack hand value (one Ace may count as 11 when it doesn't bust). */
function blackjackValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    total += blackjackPip(c.rank);
    if (c.rank === 'a') aces += 1;
  }
  while (aces > 0 && total + 10 <= 21) { total += 10; aces -= 1; }
  return total;
}

/** A natural blackjack is exactly 21 on the opening two cards. */
function isBlackjack(hand) {
  return hand.length === 2 && blackjackValue(hand) === 21;
}

/** Static card image filename ([v4.6]: `assets/casino/cards/img/{suit}_{rank}.png`). */
function cardFile(card) {
  return `${card.suit}_${card.rank}.png`;
}

/** Pretty rank for text rows (A / 2 … 10 / J / Q / K). */
function rankLabel(rank) {
  return rank.length === 1 && /[ajqk]/.test(rank) ? rank.toUpperCase() : rank;
}

module.exports = {
  SUITS,
  RANKS,
  SUIT_LABEL,
  BACK_FILE,
  drawCard,
  newDeck,
  baccaratValue,
  baccaratScore,
  blackjackPip,
  blackjackValue,
  isBlackjack,
  cardFile,
  rankLabel,
};
