'use strict';

/**
 * `crd daily limits` — view today's raid reward tracking.
 *
 * This is intentionally a read-only command. The counters are derived from the
 * immutable raid log and are also used to enforce chest limits when a chest rolls.
 */

const { EmbedBuilder } = require('discord.js');
const pool = require('../../db/pool');
const {
  formatRaidLimitStatus,
  getRaidRewardTotals,
  TODAY_RAID_TOTALS_QUERY,
} = require('../../utils/raidRewardLimits');

const TODAY_RAID_TOTALS = TODAY_RAID_TOTALS_QUERY;

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

async function execute(message) {
  try {
    const status = formatRaidLimitStatus(await getRaidRewardTotals(pool, message.author.id));
    return reply(message, {
      embeds: [new EmbedBuilder()
        .setColor(0xf0b232)
        .setTitle('Daily Reward Limits')
        .setDescription(`${status}\n\nResets at midnight PHT.`)],
    });
  } catch (err) {
    console.error('[daily limits]', err.message);
    return reply(message, { content: 'Could not read your daily reward limits right now — try again.' });
  }
}

module.exports = { execute, TODAY_RAID_TOTALS };
