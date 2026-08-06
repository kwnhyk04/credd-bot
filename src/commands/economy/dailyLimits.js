'use strict';

/**
 * `crd daily limits` — view today's raid reward tracking.
 *
 * This is intentionally a read-only command. Raid completion no longer writes
 * or locks a separate daily totals row; the counters are derived here from the
 * immutable raid log only when a player asks to see them.
 */

const { EmbedBuilder } = require('discord.js');
const pool = require('../../db/pool');
const { formatRaidLimitStatus } = require('../../utils/raidRewardLimits');

const TODAY_RAID_TOTALS = `
  SELECT
    COALESCE(SUM(CASE
      WHEN result = 'win' AND chest_dropped = 'Silver Chest' THEN 1
      ELSE 0
    END), 0)::int AS silver_chests,
    COALESCE(SUM(CASE
      WHEN result = 'win' AND chest_dropped = 'Gold Chest' THEN 1
      ELSE 0
    END), 0)::int AS gold_chests,
    COALESCE(SUM(CASE
      WHEN result = 'win' THEN belief_shards_dropped
      ELSE 0
    END), 0)::int AS belief_shards
  FROM raid_logs
  WHERE discord_id = $1
    AND battle_type = 'raid'
    AND ("timestamp" AT TIME ZONE 'Asia/Manila')::date =
        (NOW() AT TIME ZONE 'Asia/Manila')::date`;

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

async function execute(message) {
  try {
    const { rows } = await pool.query(TODAY_RAID_TOTALS, [message.author.id]);
    const row = rows[0] || {};
    const status = formatRaidLimitStatus({
      beliefShards: row.belief_shards,
      silverChests: row.silver_chests,
      goldChests: row.gold_chests,
    });
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
