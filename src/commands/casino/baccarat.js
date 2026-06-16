'use strict';

/**
 * `crd baccarat <amount> banker/player` (alias `crd bac <amount> b/p`) — The Oracle's Table.
 * Tie → push (bet returned). No banker commission.
 *
 * Sequential reveal (mechanic): deal four face-down backs (Player 2, Banker 2), then flip one
 * card at a time in baccarat order — Player 1st, Banker 1st, Player 2nd, Banker 2nd — editing the
 * message in place (mirrors blackjack's edit cadence). Any third card is dealt face-down then
 * flipped in the same style. The full outcome is decided on the backend up front; settlement is
 * computed before the reveal (locks the funds + outcome) but the NEW balance is shown only on the
 * final face-up frame, so the reveal never leaks the result early.
 */

const betGuard = require('../../casino/betGuard');
const baccarat = require('../../casino/baccarat');
const render = require('../../casino/casinoRender');
const flow = require('./flow');

const USAGE = 'Usage: `crd baccarat <amount> banker/player` (alias `crd bac <amount> b/p`)';
const SIDE = { b: 'banker', banker: 'banker', p: 'player', player: 'player' };
const FLIP_MS = 750; // short beat between each card turn

async function execute(message, { args }) {
  const side = flow.normPick(args[1], SIDE);
  if (!side) return flow.reply(message, USAGE);

  const v = await flow.validate(message, 'baccarat', args[0]);
  if (!v) return;

  const uid = message.author.id;
  const outcome = baccarat.play(v.amount, side);
  const settle = await betGuard.settleInstant({
    discordId: uid, game: 'baccarat', bet: v.amount, payout: outcome.payout,
    metadata: { pick: side, winner: outcome.winner, pScore: outcome.pScore, bScore: outcome.bScore, push: outcome.push },
  });
  if (settle.status !== 'ok') return flow.reply(message, flow.settleErrorText(settle));

  const base = { uid, bet: v.amount, pick: side, outcome };
  // Staging frames show the PRE-settlement balance; the new balance lands on the final frame.
  let pDealt = 2; let bDealt = 2; let pRev = 0; let bRev = 0;
  const frame = (note) => render.buildBaccarat({
    ...base, balance: settle.before, result: false, note,
    player: outcome.player.slice(0, pDealt), banker: outcome.banker.slice(0, bDealt), pReveal: pRev, bReveal: bRev,
  });

  // Stage 0 — four cards, all face down.
  const sent = await message.reply({
    ...(await frame('The Oracle deals — four cards, face down…')),
    allowedMentions: { repliedUser: false },
  });
  const edit = async (p) => { await sent.edit({ components: p.components, files: p.files, flags: p.flags }).catch(() => {}); };
  const step = async (note) => { await flow.sleep(FLIP_MS); await edit(await frame(note)); };

  // Flip in baccarat order: Player 1st, Banker 1st, Player 2nd, Banker 2nd.
  pRev = 1; await step('The Player’s first card is turned…');
  bRev = 1; await step('The Banker’s first card is turned…');
  pRev = 2; await step('The Player’s second card…');
  bRev = 2; await step('The Banker’s second card…');

  // Thirds (per the third-card rule already decided on the backend): deal face down, then flip.
  if (outcome.player.length === 3) {
    pDealt = 3; await step('The Player draws a third — face down…');
    pRev = 3; await step('…and turns it over.');
  }
  if (outcome.banker.length === 3) {
    bDealt = 3; await step('The Banker draws a third — face down…');
    bRev = 3; await step('…and turns it over.');
  }

  // Final — all face up, scores, verdict, and the settled balance.
  await flow.sleep(FLIP_MS);
  await edit(await render.buildBaccarat({ ...base, balance: settle.after, player: outcome.player, banker: outcome.banker, result: true }));
}

module.exports = { execute };
