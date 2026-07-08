'use strict';

/**
 * `crd boss` — re-display the current boss status (Master §16, Phase 7).
 *
 * Posts a fresh copy of the boss CV2 message in the invoking channel and
 * makes THAT message the new live/tracked one — the recovery path for
 * scrolled-away/stale/deleted messages and restarts (the old message is left
 * as-is; its Attack button still routes to live state, so it stays harmless).
 *
 * No active boss → plain-text status with when the next spawn check lands.
 */

const {
  fetchBossView, buildBossMessage, repointLiveMessage,
} = require('../../engine/bossSystem');
const { bossRedirectMessage, isOfficialGuild } = require('../../config/officialSupport');

const RESPAWN_COOLDOWN_MS = 15 * 60 * 1000;

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

async function execute(message) {
  try {
    if (!isOfficialGuild(message.guild.id)) {
      return reply(message, bossRedirectMessage());
    }

    const view = await fetchBossView(message.guild.id);
    if (!view) {
      return reply(
        message,
        'No boss has spawned in this server yet — the scheduler checks every minute. ' +
        'A configured boss channel and at least one active player are required for the first spawn.'
      );
    }

    const { state } = view;
    const now = Date.now();
    if (state.status === 'active') {
      const sent = await message.channel.send(await buildBossMessage(view));
      repointLiveMessage(message.guild.id, sent);
      if (message.isSlash) {
        await reply(message, 'Boss status posted in this channel.');
      }
      return;
    }

    // terminal (or expired-pending-tick) — show when the next spawn lands
    const endedAt = new Date(state.expires_at).getTime();
    const eligibleAt = Math.floor((endedAt + RESPAWN_COOLDOWN_MS) / 1000);
    const word = state.status === 'dead' ? 'was slain' : 'ended';
    const when = eligibleAt * 1000 > now
      ? `<t:${eligibleAt}:R>`
      : 'on the next scheduler check (within a minute)';
    return reply(message, `No active boss — the last one ${word}. Next spawn ${when}.`);
  } catch (err) {
    console.error('[boss]', err);
    return reply(message, 'Could not load the boss status — try again shortly.').catch(() => {});
  }
}

module.exports = { execute };
