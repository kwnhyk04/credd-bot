'use strict';

/**
 * `crd crash <amount>` — The Ascension. Max bet 500,000 (accepts `max`).
 *
 * Stateful push-your-luck: the bet is DEBITED up front, the pure session lives in a per-user
 * Map (ONE active crash per user), the full payout is CREDITED on resolution. Each push rolls
 * the crash chance first; survive to cash out at the locked multiplier. 60s inactivity →
 * AUTO-CASH-OUT at the current safe multiplier (player-friendly). Buttons gated + session-locked.
 */

const { MessageFlags } = require('discord.js');
const betGuard = require('../../casino/betGuard');
const sessionStore = require('../../casino/sessionStore');
const engine = require('../../casino/crash');
const render = require('../../casino/casinoRender');
const flow = require('./flow');
const { registerMemorySource } = require('../../utils/memoryRegistry');

const TIMEOUT_MS = 60_000;
const STALE_SESSION_MS = TIMEOUT_MS * 2;
const sessions = new Map(); // discord_id → wrap

function clearTimer(wrap) { if (wrap.timer) { clearTimeout(wrap.timer); wrap.timer = null; } }
function armTimer(wrap) {
  clearTimer(wrap);
  wrap.timer = setTimeout(() => { autoCashOut(wrap).catch(() => {}); }, TIMEOUT_MS);
}

async function execute(message, { args }) {
  const uid = message.author.id;
  const local = sessions.get(uid);
  if (local) {
    const playable = await sessionStore.ensurePlayableSession({
      sessionId: local.sessionId,
      discordId: uid,
      game: 'crash',
    });
    if (playable.ok) return flow.reply(message, 'Finish your current crash game first.');
    clearTimer(local);
    sessions.delete(uid);
    if (playable.status === 'expired') {
      await sessionStore.recoverExpiredSession(local.sessionId, 'start_found_expired_crash').catch(() => {});
    }
  }

  const balance = await betGuard.getBalance(uid);
  if (balance == null) return flow.reply(message, 'You need to `crd register` before visiting the casino.');
  const v = betGuard.validateBet('crash', args[0], balance);
  if (!v.ok) return flow.reply(message, v.error);

  const debit = await sessionStore.beginStatefulSession({
    discordId: uid,
    game: 'crash',
    bet: v.amount,
    channelId: message.channel.id,
    staleMs: STALE_SESSION_MS,
  });
  if (debit.status === 'active') return flow.reply(message, 'Finish your current crash game first.');
  if (debit.status !== 'ok') return flow.reply(message, flow.settleErrorText(debit));

  const session = engine.create(v.amount);
  const wrap = {
    uid,
    sessionId: debit.sessionId,
    bet: v.amount,
    session,
    balanceBefore: debit.before,
    held: debit.after,
    // Only ids are retained — never the full Discord Message object — so the
    // wrap cannot pin embeds/attachments/components for the session lifetime.
    channel: null,
    messageId: null,
    timer: null,
    resolving: false,
    actionPending: false,
    createdAt: Date.now(),
  };
  sessions.set(uid, wrap);

  try {
    const payload = await render.buildCrash({ uid, bet: v.amount, session, balance: debit.after });
    const sent = await message.reply({ ...payload, allowedMentions: { repliedUser: false } });
    wrap.channel = sent.channel;
    wrap.messageId = sent.id;
    await sessionStore.attachMessage(debit.sessionId, { channelId: message.channel.id, messageId: sent.id }).catch(() => {});
    armTimer(wrap);
  } catch (err) {
    clearTimer(wrap);
    sessions.delete(uid);
    throw err;
  }
}

async function handleButton(interaction, action, ownerId) {
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'This is not your game.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const wrap = sessions.get(ownerId);
  if (!wrap || wrap.messageId !== interaction.message.id) {
    return interaction.reply({ content: 'This game has already ended.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  // Claim the action synchronously before the first await. Discord can deliver a
  // second click while the first database check/render is still in flight; without
  // this guard one visible click sequence can consume multiple independent pushes.
  if (wrap.resolving || wrap.actionPending) return interaction.deferUpdate().catch(() => {});
  wrap.actionPending = true;
  clearTimer(wrap);

  try {
    await interaction.deferUpdate();
    const playable = await sessionStore.ensurePlayableSession({
      sessionId: wrap.sessionId,
      discordId: ownerId,
      game: 'crash',
    });
    if (!playable.ok) {
      clearTimer(wrap);
      sessions.delete(ownerId);
      if (playable.status === 'expired') {
        await sessionStore.recoverExpiredSession(wrap.sessionId, 'button_expired_crash').catch(() => {});
        return interaction.followUp({ content: 'This crash session expired and the bet was refunded. Start a new game.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return interaction.followUp({ content: 'This crash session has already ended.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (action === 'push') {
      const ev = engine.pushNext(wrap.session);
      if (ev.crashed) {
        await resolve(wrap, async (p) => {
          try {
            await interaction.editReply(p);
          } catch (err) {
            console.error('[crash] final refresh failed:', err);
            await interaction.followUp({
              content: 'Crash settled, but the game message could not refresh. Check your balance before starting another game.',
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }
        });
        return;
      }
      armTimer(wrap);
      const payload = await render.buildCrash({ uid: ownerId, bet: wrap.bet, session: wrap.session, balance: wrap.held });
      await interaction.editReply({ components: payload.components, files: payload.files, flags: payload.flags }).catch(async (err) => {
        console.error('[crash] active refresh failed:', err);
        await interaction.followUp({ content: 'Crash action was processed, but the view failed to refresh. Avoid clicking again until you start a new game or the message updates.', flags: MessageFlags.Ephemeral }).catch(() => {});
      });
    } else if (action === 'cashout') {
      engine.cashOut(wrap.session);
      await resolve(wrap, async (p) => {
        try {
          await interaction.editReply(p);
        } catch (err) {
          console.error('[crash] cashout refresh failed:', err);
          await interaction.followUp({
            content: 'Crash cashout settled, but the game message could not refresh. Check your balance before starting another game.',
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      });
    }
  } catch (err) {
    console.error('[crash] button failed:', err);
    await interaction.followUp({ content: 'Crash action could not finish cleanly. Check the game message or your balance before clicking again.', flags: MessageFlags.Ephemeral }).catch(() => {});
  } finally {
    wrap.actionPending = false;
    if (sessions.get(ownerId) === wrap
        && !wrap.resolving
        && wrap.session.state === 'active'
        && !wrap.timer) {
      armTimer(wrap);
    }
  }
}

/** Auto-cash-out at the current safe multiplier on inactivity timeout. */
async function autoCashOut(wrap) {
  if (wrap.resolving || wrap.actionPending || wrap.session.state !== 'active') return;
  engine.cashOut(wrap.session);
  // Same REST route as Message#edit (PATCH /channels/:id/messages/:id).
  await resolve(wrap, (p) => wrap.channel.messages.edit(wrap.messageId, p));
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
    const r = await sessionStore.settleStatefulSession({
      sessionId: wrap.sessionId,
      discordId: wrap.uid,
      game: 'crash',
      payout: s.payout,
      metadata: meta,
    });
    if (r.status !== 'settled') throw new Error(`crash session ${wrap.sessionId} is ${r.status}`);
    after = r.after;
  } catch (err) {
    console.error('[crash] resolve', err);
    wrap.resolving = false;
    armTimer(wrap);
    throw err;
  }
  sessions.delete(wrap.uid);
  const payload = await render.buildCrash({ uid: wrap.uid, bet: wrap.bet, session: s, balance: after });
  await applyEdit({ components: payload.components, files: payload.files, flags: payload.flags }).catch(() => {});
}

function getCrashSessionStats() {
  const values = [...sessions.values()];
  const oldest = values.reduce((min, wrap) => Math.min(min, wrap.createdAt || Date.now()), Date.now());
  return {
    entries: sessions.size,
    timers: values.filter((wrap) => Boolean(wrap.timer)).length,
    resolving: values.filter((wrap) => wrap.resolving).length,
    actionPending: values.filter((wrap) => wrap.actionPending).length,
    oldestMs: values.length ? Date.now() - oldest : 0,
  };
}

registerMemorySource('casino.crash-sessions', getCrashSessionStats);

module.exports = { execute, handleButton, getCrashSessionStats };
