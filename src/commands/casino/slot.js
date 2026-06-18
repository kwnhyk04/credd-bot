'use strict';

/**
 * `crd slot machine <amount>` (alias `crd sm <amount>`) — The Vault of Relics.
 * Staggered reveal comes from the reels' own 3s/4s/5s GIF lengths.
 */

const betGuard = require('../../casino/betGuard');
const slotMachine = require('../../casino/slotMachine');
const render = require('../../casino/casinoRender');
const flow = require('./flow');

async function execute(message, { args }) {
  const a = flow.stripSub(args, 'machine');
  const v = await flow.validate(message, 'slot_machine', a[0]);
  if (!v) return;

  const uid = message.author.id;
  const outcome = slotMachine.play(v.amount);
  const settle = await betGuard.settleInstant({
    discordId: uid, game: 'slot_machine', bet: v.amount, payout: outcome.payout,
    metadata: { reels: outcome.reels, face: outcome.face, mult: outcome.mult },
  });
  if (settle.status !== 'ok') return flow.reply(message, flow.settleErrorText(settle));

  // Reels stagger; reveal just after the third reel lands. Delay lives in render.WAIT.slot.
  const spin = await render.buildSlot({ phase: 'spin', uid, bet: v.amount, outcome, balance: settle.before });
  await flow.twoPhase(
    message, spin,
    () => render.buildSlot({ phase: 'result', uid, bet: v.amount, outcome, balance: settle.after }),
    render.WAIT.slot,
  );
}

module.exports = { execute };
