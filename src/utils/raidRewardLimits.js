'use strict';

const { emojiForDisplay } = require('./emojis');

/**
 * Persistent daily raid-reward allocation.
 *
 * The caller must already be inside the reward transaction. The daily row is
 * inserted lazily for the current PHT date and locked before the allowance is
 * calculated, so simultaneous raid completions serialize per user. The caller
 * must apply the returned grant in the same transaction.
 */

const TODAY_PHT = `(NOW() AT TIME ZONE 'Asia/Manila')::date`;

const RAID_REWARD_LIMITS = Object.freeze({
  silverChests: 20,
  goldChests: 10,
  beliefShards: 10_000,
});

const nonNegativeInt = (value) => Math.max(0, Math.floor(Number(value) || 0));

/** Pure cap calculation used by the DB allocator and deterministic tests. */
function capRaidRewards({
  current = {},
  requested = {},
  regularRaid = false,
  eliteMobRaid = false,
} = {}) {
  const currentSilver = nonNegativeInt(current.silverChests);
  const currentGold = nonNegativeInt(current.goldChests);
  const currentShards = nonNegativeInt(current.beliefShards);
  const requestedSilver = regularRaid ? nonNegativeInt(requested.silverChests) : 0;
  const requestedGold = eliteMobRaid ? nonNegativeInt(requested.goldChests) : 0;
  const requestedShards = nonNegativeInt(requested.beliefShards);

  const granted = {
    silverChests: Math.min(requestedSilver, Math.max(0, RAID_REWARD_LIMITS.silverChests - currentSilver)),
    goldChests: Math.min(requestedGold, Math.max(0, RAID_REWARD_LIMITS.goldChests - currentGold)),
    beliefShards: Math.min(requestedShards, Math.max(0, RAID_REWARD_LIMITS.beliefShards - currentShards)),
  };
  return {
    granted,
    blocked: {
      silverChests: requestedSilver - granted.silverChests,
      goldChests: requestedGold - granted.goldChests,
      beliefShards: requestedShards - granted.beliefShards,
    },
    totals: {
      silverChests: Math.min(RAID_REWARD_LIMITS.silverChests, currentSilver + granted.silverChests),
      goldChests: Math.min(RAID_REWARD_LIMITS.goldChests, currentGold + granted.goldChests),
      beliefShards: Math.min(RAID_REWARD_LIMITS.beliefShards, currentShards + granted.beliefShards),
    },
  };
}

function raidLimitNotices(allocation) {
  const { granted, blocked, totals } = allocation;
  const notices = [];
  if (blocked.silverChests > 0) {
    notices.push(granted.silverChests > 0
      ? `You received ${granted.silverChests} Silver Chest${granted.silverChests === 1 ? '' : 's'}. ` +
        `${blocked.silverChests} exceeded your daily raid limit of ${RAID_REWARD_LIMITS.silverChests}.`
      : `Daily raid limit reached: ${totals.silverChests}/${RAID_REWARD_LIMITS.silverChests} Silver Chests.`);
  }
  if (blocked.goldChests > 0) {
    notices.push(granted.goldChests > 0
      ? `You received ${granted.goldChests} Gold Chest${granted.goldChests === 1 ? '' : 's'}. ` +
        `${blocked.goldChests} exceeded your daily Elite Mob raid limit of ${RAID_REWARD_LIMITS.goldChests}.`
      : `Daily raid limit reached: ${totals.goldChests}/${RAID_REWARD_LIMITS.goldChests} Gold Chests.`);
  }
  if (blocked.beliefShards > 0) {
    notices.push(granted.beliefShards > 0
      ? `You received ${granted.beliefShards.toLocaleString()} Belief Shards. ` +
        `The remaining ${blocked.beliefShards.toLocaleString()} exceeded your daily raid limit of ${RAID_REWARD_LIMITS.beliefShards.toLocaleString()}.`
      : `Daily raid limit reached: ${totals.beliefShards.toLocaleString()}/${RAID_REWARD_LIMITS.beliefShards.toLocaleString()} Belief Shards.`);
  }
  return notices;
}

/**
 * Plain-text daily tracking line shown after a raid's reward embeds.
 * Both raid chest counters are exposed in the player-facing line, even when
 * the current raid did not drop either chest.
 */
function formatRaidLimitStatus(totals = {}) {
  const shards = Math.min(RAID_REWARD_LIMITS.beliefShards, nonNegativeInt(totals.beliefShards));
  const silver = Math.min(RAID_REWARD_LIMITS.silverChests, nonNegativeInt(totals.silverChests));
  const gold = Math.min(RAID_REWARD_LIMITS.goldChests, nonNegativeInt(totals.goldChests));
  const shardIcon = emojiForDisplay('Belief Shards', '🔮');
  const silverIcon = emojiForDisplay('Silver Chest', '🥈');
  const goldIcon = emojiForDisplay('Gold Chest', '🥇');
  return `${shardIcon} Belief Shards: ${shards.toLocaleString()}/${RAID_REWARD_LIMITS.beliefShards.toLocaleString()} · `
    + `${silverIcon} Silver Chest: ${silver}/${RAID_REWARD_LIMITS.silverChests} · `
    + `${goldIcon} Gold Chest: ${gold}/${RAID_REWARD_LIMITS.goldChests}`;
}

/** Allocate the capped part of a raid reward and advance the locked daily row. */
async function allocateRaidRewardLimits(client, discordId, requested, {
  regularRaid = false,
  eliteMobRaid = false,
} = {}) {
  await client.query(
    `INSERT INTO raid_reward_daily_totals
       (discord_id, reward_date, silver_chests, gold_chests, belief_shards)
     VALUES ($1, ${TODAY_PHT}, 0, 0, 0)
     ON CONFLICT (discord_id, reward_date) DO NOTHING`,
    [discordId],
  );
  const currentRes = await client.query(
    `SELECT silver_chests, gold_chests, belief_shards
       FROM raid_reward_daily_totals
      WHERE discord_id = $1 AND reward_date = ${TODAY_PHT}
      FOR UPDATE`,
    [discordId],
  );
  if (currentRes.rows.length === 0) throw new Error('raid daily reward tracking row missing');

  const current = {
    silverChests: currentRes.rows[0].silver_chests,
    goldChests: currentRes.rows[0].gold_chests,
    beliefShards: currentRes.rows[0].belief_shards,
  };
  const allocation = capRaidRewards({ current, requested, regularRaid, eliteMobRaid });
  await client.query(
    `UPDATE raid_reward_daily_totals
        SET silver_chests = $2,
            gold_chests = $3,
            belief_shards = $4
      WHERE discord_id = $1 AND reward_date = ${TODAY_PHT}`,
    [
      discordId,
      allocation.totals.silverChests,
      allocation.totals.goldChests,
      allocation.totals.beliefShards,
    ],
  );
  return { ...allocation, notices: raidLimitNotices(allocation) };
}

module.exports = {
  RAID_REWARD_LIMITS,
  capRaidRewards,
  formatRaidLimitStatus,
  raidLimitNotices,
  allocateRaidRewardLimits,
};
