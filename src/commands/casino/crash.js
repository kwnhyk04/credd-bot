'use strict';

/**
 * `crd crash <amount>` — The Ascension. Max bet 25,000.
 *
 * Stateful push-your-luck: the bet is DEBITED up front, the pure session lives in a per-user
 * Map (ONE active crash per user), the full payout is CREDITED on resolution. Each push rolls
 * the crash chance first; survive to cash out at the locked multiplier. 60s inactivity →
 * AUTO-CASH-OUT at the current safe multiplier (player-friendly). Buttons gated + session-locked.
 */

const { MessageFlags } = require('discord.js');
const betGuard = require('../../casino/betGuard');
const engine = require('../../casino/crash');
const render = require('../../casino/casinoRender');
const flow = require('./flow');

const TIMEOUT_MS = 60_000;
const sessions = new Map(); // discord_id → wrap

function clearTimer(wrap) { if (wrap.timer) { clearTimeout(wrap.timer); wrap.timer = null; } }
function armTimer(wrap) {
  clearTimer(wrap);
  wrap.timer = setTimeout(() => { autoCashOut(wrap).catch(() => {}); }, TIMEOUT_MS);
}

async function execute(message, { args }) {
  const uid = message.author.id;
  if (sessions.has(uid)) return flow.reply(message, 'Finish your current crash game first.');

  const balance = await betGuard.getBalance(uid);
  if (balance == null) return flow.reply(message, 'You need to `crd register` before visiting the casino.');
  const v = betGuard.validateBet('crash', args[0], balance);
  if (!v.ok) return flow.reply(message, v.error);

  const debit = await betGuard.debitBet({ discordId: uid, bet: v.amount });
  if (debit.status !== 'ok') return flow.reply(message, flow.settleErrorText(debit));

  const session = engine.create(v.amount);
  const wrap = { uid, bet: v.amount, session, balanceBefore: debit.before, held: debit.after, message: null, timer: null, resolving: false };
  sessions.set(uid, wrap);

  const payload = await render.buildCrash({ uid, bet: v.amount, session, balance: debit.after });
  wrap.message = await message.reply({ ...payload, allowedMentions: { repliedUser: false } });
  armTimer(wrap);
}

async function handleButton(interaction, action, ownerId) {
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'This is not your game.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const wrap = sessions.get(ownerId);
  if (!wrap || wrap.message?.id !== interaction.message.id) {
    return interaction.reply({ content: 'This game has already ended.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (wrap.resolving) return interaction.deferUpdate().catch(() => {});

  if (action === 'push') {
    const ev = engine.pushNext(wrap.session);
    if (ev.crashed) {
      await resolve(wrap, (p) => interaction.update(p));
      return;
    }
    armTimer(wrap);
    const payload = await render.buildCrash({ uid: ownerId, bet: wrap.bet, session: wrap.session, balance: wrap.held });
    await interaction.update({ components: payload.components, files: payload.files, flags: payload.flags }).catch(() => {});
  } else if (action === 'cashout') {
    engine.cashOut(wrap.session);
    await resolve(wrap, (p) => interaction.update(p));
  }
}

/** Auto-cash-out at the current safe multiplier on inactivity timeout. */
async function autoCashOut(wrap) {
  if (wrap.resolving || wrap.session.state !== 'active') return;
  engine.cashOut(wrap.session);
  await resolve(wrap, (p) => wrap.message.edit(p));
}

async function resolve(wrap, applyEdit) {
  if (wrap.resolving) return;
  wrap.resolving = true;
  clearTimer(wrap);
  const s = wrap.session;
  const meta = {
    pushes: s.push,
    crashed: s.state === 'crashed',
    multiplier: s.state === 'cashed' ? s.multiplier : null,
    crash_point: s.crashPoint,
  };
  let after = wrap.balanceBefore - wrap.bet + s.payout;
  try {
    const r = await betGuard.resolveStateful({
      discordId: wrap.uid, game: 'crash', bet: wrap.bet, payout: s.payout,
      balanceBefore: wrap.balanceBefore, metadata: meta,
    });
    after = r.after;
  } catch (err) {
    console.error('[crash] resolve', err);
  }
  sessions.delete(wrap.uid);
  const payload = await render.buildCrash({ uid: wrap.uid, bet: wrap.bet, session: s, balance: after });
  await applyEdit({ components: payload.components, files: payload.files, flags: payload.flags }).catch(() => {});
}

module.exports = { execute, handleButton };
