'use strict';

/**
 * `crd blackjack <amount>` (alias `crd bj <amount>`) — The Sacred XXI.
 *
 * Stateful: bet DEBITED up front, pure session in an in-memory Map (ONE per user), full payout
 * CREDITED on resolution. 60s inactivity → auto-stand. Buttons gated + session-locked. Hands render
 * as small centered card-strips (active = dealer hole hidden; final = revealed + centered banner).
 */

const { MessageFlags } = require('discord.js');
const betGuard = require('../../casino/betGuard');
const sessionStore = require('../../casino/sessionStore');
const engine = require('../../casino/blackjack');
const { blackjackValue } = require('../../casino/cardDeck');
const render = require('../../casino/casinoRender');
const flow = require('./flow');

const TIMEOUT_MS = 60_000;
const STALE_SESSION_MS = TIMEOUT_MS * 2;
const sessions = new Map();

function clearTimer(wrap) { if (wrap.timer) { clearTimeout(wrap.timer); wrap.timer = null; } }
function armTimer(wrap) {
  clearTimer(wrap);
  wrap.timer = setTimeout(() => { autoStand(wrap).catch(() => {}); }, TIMEOUT_MS);
}

async function execute(message, { args }) {
  const uid = message.author.id;
  const local = sessions.get(uid);
  if (local) {
    const playable = await sessionStore.ensurePlayableSession({
      sessionId: local.sessionId,
      discordId: uid,
      game: 'blackjack',
    });
    if (playable.ok) return flow.reply(message, 'Finish your current blackjack game first.');
    clearTimer(local);
    sessions.delete(uid);
    if (playable.status === 'expired') {
      await sessionStore.recoverExpiredSession(local.sessionId, 'start_found_expired_blackjack').catch(() => {});
    }
  }

  const balance = await betGuard.getBalance(uid);
  if (balance == null) return flow.reply(message, 'You need to `crd register` before visiting the casino.');
  const v = betGuard.validateBet('blackjack', args[0], balance);
  if (!v.ok) return flow.reply(message, v.error);

  const debit = await sessionStore.beginStatefulSession({
    discordId: uid,
    game: 'blackjack',
    bet: v.amount,
    channelId: message.channel.id,
    staleMs: STALE_SESSION_MS,
  });
  if (debit.status === 'active') return flow.reply(message, 'Finish your current blackjack game first.');
  if (debit.status !== 'ok') return flow.reply(message, flow.settleErrorText(debit));

  const session = engine.create(v.amount);
  const wrap = {
    uid,
    sessionId: debit.sessionId,
    bet: v.amount,
    session,
    balanceBefore: debit.before,
    held: debit.after,
    message: null,
    timer: null,
    resolving: false,
    settled: false,
  };
  sessions.set(uid, wrap);

  if (session.state === 'done') {
    // Natural on the deal → settle and show the final card immediately.
    const after = await settleMoney(wrap);
    const fin = await render.buildBlackjack({ mode: 'final', uid, bet: v.amount, session, balance: after });
    wrap.message = await message.reply({ ...fin, allowedMentions: { repliedUser: false } });
    await sessionStore.attachMessage(debit.sessionId, { channelId: message.channel.id, messageId: wrap.message.id }).catch(() => {});
    sessions.delete(uid);
  } else {
    const active = await render.buildBlackjack({ mode: 'active', uid, bet: v.amount, session, balance: debit.after });
    wrap.message = await message.reply({ ...active, allowedMentions: { repliedUser: false } });
    await sessionStore.attachMessage(debit.sessionId, { channelId: message.channel.id, messageId: wrap.message.id }).catch(() => {});
    armTimer(wrap);
  }
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

  const playable = await sessionStore.ensurePlayableSession({
    sessionId: wrap.sessionId,
    discordId: ownerId,
    game: 'blackjack',
  });
  if (!playable.ok) {
    clearTimer(wrap);
    sessions.delete(ownerId);
    if (playable.status === 'expired') {
      await sessionStore.recoverExpiredSession(wrap.sessionId, 'button_expired_blackjack').catch(() => {});
      return interaction.reply({ content: 'This blackjack session expired and the bet was refunded. Start a new game.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return interaction.reply({ content: 'This blackjack session has already ended.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  if (action === 'hit') engine.hit(wrap.session);
  else if (action === 'stand') engine.stand(wrap.session);

  if (wrap.session.state === 'done') {
    await finalize(wrap, (p) => interaction.update(p));
  } else {
    armTimer(wrap);
    const payload = await render.buildBlackjack({ mode: 'active', uid: ownerId, bet: wrap.bet, session: wrap.session, balance: wrap.held });
    await interaction.update({ components: payload.components, files: payload.files, flags: payload.flags }).catch(() => {});
  }
}

async function autoStand(wrap) {
  if (wrap.resolving || wrap.session.state === 'done') return;
  engine.stand(wrap.session);
  await finalize(wrap, (p) => wrap.message.edit(p));
}

/** Credit the payout once (idempotent) and write the bracketing log row. */
async function settleMoney(wrap) {
  if (wrap.settled) return wrap.after;
  const s = wrap.session;
  const meta = {
    outcome: s.outcome,
    player_value: blackjackValue(s.player),
    dealer_value: blackjackValue(s.dealer),
    player: s.player.map((c) => c.rank),
    dealer: s.dealer.map((c) => c.rank),
  };
  let after = wrap.balanceBefore - wrap.bet + s.payout;
  const r = await sessionStore.settleStatefulSession({
    sessionId: wrap.sessionId,
    discordId: wrap.uid,
    game: 'blackjack',
    payout: s.payout,
    metadata: meta,
  });
  if (r.status !== 'settled') throw new Error(`blackjack session ${wrap.sessionId} is ${r.status}`);
  after = r.after;
  wrap.after = after;
  wrap.settled = true;
  return after;
}

async function finalize(wrap, applyEdit) {
  if (wrap.resolving) return;
  wrap.resolving = true;
  clearTimer(wrap);
  let after;
  try {
    after = await settleMoney(wrap);
  } catch (err) {
    wrap.resolving = false;
    armTimer(wrap);
    throw err;
  }
  const payload = await render.buildBlackjack({ mode: 'final', uid: wrap.uid, bet: wrap.bet, session: wrap.session, balance: after });
  await applyEdit({ components: payload.components, files: payload.files, flags: payload.flags }).catch(() => {});
  sessions.delete(wrap.uid);
}

module.exports = { execute, handleButton };
