'use strict';

/**
 * `crd dice roll <amount> odd/even` (alias `crd dr <amount> o/e`) — Trial of the Ancients.
 */

const betGuard = require('../../casino/betGuard');
const diceRoll = require('../../casino/diceRoll');
const render = require('../../casino/casinoRender');
const flow = require('./flow');

const USAGE = 'Usage: `crd dice roll <amount> odd/even` (alias `crd dr <amount> o/e`)';
const SIDE = { o: 'odd', odd: 'odd', e: 'even', even: 'even' };

async function execute(message, { args }) {
  const a = flow.stripSub(args, 'roll');
  const side = flow.normPick(a[1], SIDE);
  if (!side) return flow.reply(message, USAGE);

  const v = await flow.validate(message, 'dice_roll', a[0]);
  if (!v) return;

  const uid = message.author.id;
  const outcome = diceRoll.play(v.amount, side);
  const settle = await betGuard.settleInstant({
    discordId: uid, game: 'dice_roll', bet: v.amount, payout: outcome.payout,
    metadata: { pick: side, d1: outcome.d1, d2: outcome.d2, sum: outcome.sum, parity: outcome.parity },
  });
  if (settle.status !== 'ok') return flow.reply(message, flow.settleErrorText(settle));

  // Swap just after the dice visually settle (render.WAIT.dice).
  const spin = await render.buildDice({ phase: 'spin', uid, bet: v.amount, pick: side, outcome, balance: settle.before });
  await flow.twoPhase(
    message, spin,
    () => render.buildDice({ phase: 'result', uid, bet: v.amount, pick: side, outcome, balance: settle.after }),
    render.WAIT.dice,
  );
}

module.exports = { execute };
