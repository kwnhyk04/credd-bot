'use strict';

/**
 * baccarat.js — pure baccarat engine (Master §24). Standard punto banco:
 *   - 2 cards each; a natural (either hand 8 or 9 on the first two) stands.
 *   - else PLAYER draws a third on 0–5, stands 6–7.
 *   - else BANKER draws per the standard third-card matrix (vs player's third-card value).
 * NO banker commission (virtual-economy 100%-payout rule). Player/Banker win → 2×.
 * Tie → PUSH (bet returned).
 *
 * Pure: (bet, pick, rng) -> outcome. No DB, no Discord, no Math.random.
 */

const { EVEN_MONEY } = require('./payoutTables');
const { newDeck, baccaratValue, baccaratScore } = require('./cardDeck');
const { rng: defaultRng } = require('./rng');

/** @param {'player'|'banker'} pick */
function play(bet, pick, rng = defaultRng) {
  // [v4.7] one 52-card deck per round, dealt without replacement (no duplicate suit+rank in a hand).
  const deck = newDeck(rng);
  const player = [deck.draw(), deck.draw()];
  const banker = [deck.draw(), deck.draw()];

  const pTwo = baccaratScore(player);
  const bTwo = baccaratScore(banker);
  const natural = pTwo >= 8 || bTwo >= 8;

  let playerThirdVal = null; // baccarat point of player's drawn third card (null if none)

  if (!natural) {
    if (pTwo <= 5) {
      const c = deck.draw();
      player.push(c);
      playerThirdVal = baccaratValue(c.rank);
    }

    // Banker draws against its ORIGINAL two-card score (bTwo).
    let bankerDraws;
    if (playerThirdVal === null) {
      bankerDraws = bTwo <= 5; // player stood → banker draws on 0–5
    } else {
      const pt = playerThirdVal;
      if (bTwo <= 2) bankerDraws = true;
      else if (bTwo === 3) bankerDraws = pt !== 8;
      else if (bTwo === 4) bankerDraws = pt >= 2 && pt <= 7;
      else if (bTwo === 5) bankerDraws = pt >= 4 && pt <= 7;
      else if (bTwo === 6) bankerDraws = pt >= 6 && pt <= 7;
      else bankerDraws = false; // 7 stands
    }
    if (bankerDraws) banker.push(deck.draw());
  }

  const pScore = baccaratScore(player);
  const bScore = baccaratScore(banker);
  const winner = pScore > bScore ? 'player' : bScore > pScore ? 'banker' : 'tie';
  const push = winner === 'tie';
  const win = push ? null : winner === pick;

  return {
    game: 'baccarat',
    player,
    banker,
    pScore,
    bScore,
    winner,
    pick,
    push,
    win,
    payout: push ? bet : win ? bet * EVEN_MONEY : 0,
  };
}

module.exports = { play };
