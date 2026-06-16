'use strict';

/**
 * `crd coin toss <amount> heads/tails` (alias `crd ct <amount> h/t`) — Coin of Fates.
 * Thin command: parse → validate → engine → settle → animate. All logic is in casino/.
 */

const betGuard = require('../../casino/betGuard');
const coinToss = require('../../casino/coinToss');
const render = require('../../casino/casinoRender');
const flow = require('./flow');

const USAGE = 'Usage: `crd coin toss <amount> heads/tails` (alias `crd ct <amount> h/t`)';
const SIDE = { h: 'heads', heads: 'heads', t: 'tails', tails: 'tails' };

async function execute(message, { args }) {
  const a = flow.stripSub(args, 'toss');
  const side = flow.normPick(a[1], SIDE);
  if (!side) return flow.reply(message, USAGE);

  const v = await flow.validate(message, 'coin_toss', a[0]);
  if (!v) return;

  const uid = message.author.id;
  const outcome = coinToss.play(v.amount, side);
  const settle = await betGuard.settleInstant({
    discordId: uid, game: 'coin_toss', bet: v.amount, payout: outcome.payout,
    metadata: { pick: side, result: outcome.result },
  });
  if (settle.status !== 'ok') return flow.reply(message, flow.settleErrorText(settle));

  // Swap to the result just after the coin's visual spin settles (render.WAIT.coin).
  const spin = await render.buildCoin({ phase: 'spin', uid, bet: v.amount, pick: side, outcome, balance: settle.before });
  await flow.twoPhase(
    message, spin,
    () => render.buildCoin({ phase: 'result', uid, bet: v.amount, pick: side, outcome, balance: settle.after }),
    render.WAIT.coin,
  );
}

module.exports = { execute };
