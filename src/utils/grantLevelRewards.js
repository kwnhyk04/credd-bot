'use strict';

/**
 * grantLevelRewards — exactly-once crediting of Combat / Believer level rewards
 * (Genesis update, spec sections 1-3). Follows the quest-reward pattern
 * (questProgress.js): every function REQUIRES an open-transaction `client`; the
 * CALLER owns BEGIN/COMMIT/ROLLBACK, so the tracking rows, the users_bag
 * credit, and the caller's other writes commit or roll back together.
 *
 * Exactly-once mechanism: INSERT ... ON CONFLICT DO NOTHING RETURNING against
 * the (discord_id, level) primary keys of combat_level_rewards /
 * believer_level_rewards. Only levels actually inserted here are credited —
 * repeated events, retries, concurrent transactions, restarts, and
 * compensation reruns all collapse on the conflict and credit nothing.
 * The tracking rows are never "recorded without payment": a failed credit
 * throws, the caller rolls back, and the inserted rows vanish with it.
 *
 * Lock-order convention (Phase 5 / awardCombatExp header): users_bag BEFORE
 * user_character. Callers must hold (or be about to take via this UPDATE) the
 * bag lock consistent with that order — raid/summon/relic flows all lock the
 * bag first already.
 */

const {
  MIN_REWARD_LEVEL,
  MAX_REWARD_LEVEL,
  REWARD_CHEST_COLUMNS,
  sumLevelRewards,
} = require('../config/levelRewards');

const TABLES = Object.freeze({
  combat: 'combat_level_rewards',
  believer: 'believer_level_rewards',
});

const LOG_ACTION = 'Level Reward';

function clampRange(previousLevel, newLevel) {
  const from = Math.max(Number(previousLevel) + 1, MIN_REWARD_LEVEL);
  const to = Math.min(Number(newLevel), MAX_REWARD_LEVEL);
  return from <= to ? { from, to } : null;
}

/** Build the guarded users_bag credit UPDATE for one user. */
function buildBagUpdate(rewards) {
  const sets = [
    'credux = credux + $2',
    'lifetime_credux_earned = lifetime_credux_earned + $2',
  ];
  const params = [rewards.credux];
  for (const col of REWARD_CHEST_COLUMNS) {
    const qty = rewards.chests[col];
    if (!qty) continue;
    params.push(qty);
    sets.push(`${col} = ${col} + $${params.length + 1}`);
  }
  const returning = ['credux', ...REWARD_CHEST_COLUMNS].join(', ');
  return {
    sql: `UPDATE users_bag SET ${sets.join(', ')} WHERE discord_id = $1 RETURNING ${returning}`,
    params,
  };
}

async function writeGameLogs(client, discordId, rewards, bagAfter) {
  if (rewards.credux > 0) {
    const after = Number(bagAfter.credux);
    await client.query(
      `INSERT INTO game_logs (discord_id, action, previous_credux, updated_credux)
       VALUES ($1, $2, $3, $4)`,
      [discordId, LOG_ACTION, after - rewards.credux, after]
    );
  }
  for (const col of REWARD_CHEST_COLUMNS) {
    const qty = rewards.chests[col];
    if (!qty) continue;
    const after = Number(bagAfter[col]);
    await client.query(
      `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [discordId, LOG_ACTION, col, after - qty, after]
    );
  }
}

/**
 * Core single-user grant.
 * @returns {{ credux, chests, levels }|null} null when nothing new was granted.
 */
async function grantLevelRewardsFor(kind, client, discordId, previousLevel, newLevel, source = 'levelup') {
  const range = clampRange(previousLevel, newLevel);
  if (!range) return null;

  // Exactly-once filter: only levels inserted right now are credited.
  const inserted = await client.query(
    `INSERT INTO ${TABLES[kind]} (discord_id, level, source)
     SELECT $1, gs, $2 FROM generate_series($3::int, $4::int) AS gs
     ON CONFLICT DO NOTHING
     RETURNING level`,
    [discordId, source, range.from, range.to]
  );
  if (inserted.rows.length === 0) return null;

  const levels = inserted.rows.map((r) => Number(r.level));
  const rewards = sumLevelRewards(kind, levels);
  if (rewards.credux <= 0 && Object.keys(rewards.chests).length === 0) return null;

  const upd = buildBagUpdate(rewards);
  const bag = await client.query(upd.sql, [discordId, ...upd.params]);
  if (bag.rows.length === 0) {
    // No bag row: abort the whole grant — the caller's ROLLBACK also removes
    // the tracking rows inserted above (never record without paying).
    throw new Error(`grantLevelRewards: no users_bag row for ${discordId}`);
  }
  await writeGameLogs(client, discordId, rewards, bag.rows[0]);

  return { credux: rewards.credux, chests: rewards.chests, levels };
}

/** Combat Level rewards for one user (raid / duel / auto-raid paths). */
function grantCombatLevelRewards(client, discordId, previousLevel, newLevel, source = 'levelup') {
  return grantLevelRewardsFor('combat', client, discordId, previousLevel, newLevel, source);
}

/** Believer Level rewards for one user (command exp / summon reputation paths). */
function grantBelieverLevelRewards(client, discordId, previousLevel, newLevel, source = 'levelup') {
  return grantLevelRewardsFor('believer', client, discordId, previousLevel, newLevel, source);
}

/**
 * Set-based Combat Level grant for the boss path (mirrors awardCombatExpMany).
 * @param {Map<string, {previousLevel:number,newLevel:number}>} levelUps
 * @returns {Map<string, { credux, chests, levels }>} per-user grants (only users granted something)
 */
async function grantCombatLevelRewardsMany(client, levelUps, source = 'levelup') {
  const out = new Map();
  const ids = [], froms = [], tos = [];
  for (const [discordId, info] of levelUps || []) {
    const range = clampRange(info.previousLevel, info.newLevel);
    if (!range) continue;
    ids.push(discordId);
    froms.push(range.from);
    tos.push(range.to);
  }
  if (ids.length === 0) return out;

  const inserted = await client.query(
    `INSERT INTO combat_level_rewards (discord_id, level, source)
     SELECT u.discord_id, gs.level, $4
       FROM unnest($1::varchar[], $2::int[], $3::int[]) AS u(discord_id, from_lvl, to_lvl)
      CROSS JOIN LATERAL generate_series(u.from_lvl, u.to_lvl) AS gs(level)
     ON CONFLICT DO NOTHING
     RETURNING discord_id, level`,
    [ids, froms, tos, source]
  );
  if (inserted.rows.length === 0) return out;

  const perUserLevels = new Map();
  for (const row of inserted.rows) {
    const list = perUserLevels.get(row.discord_id) || [];
    list.push(Number(row.level));
    perUserLevels.set(row.discord_id, list);
  }

  const updIds = [], updCredux = [], updGold = [], updBtc = [], updBgtc = [];
  for (const [discordId, levels] of perUserLevels) {
    const rewards = sumLevelRewards('combat', levels);
    out.set(discordId, { credux: rewards.credux, chests: rewards.chests, levels });
    updIds.push(discordId);
    updCredux.push(rewards.credux);
    updGold.push(rewards.chests.gold_chest || 0);
    updBtc.push(rewards.chests.boss_treasure_chest || 0);
    updBgtc.push(rewards.chests.boss_golden_chest || 0);
  }

  // Deadlock safety: take the bag locks in sorted-id order before the
  // set-based UPDATE (same discipline as awardCombatExpMany's char locks).
  await client.query(
    `SELECT 1 FROM users_bag WHERE discord_id = ANY($1) ORDER BY discord_id FOR UPDATE`,
    [[...updIds].sort()]
  );
  const bag = await client.query(
    `UPDATE users_bag ub
        SET credux = ub.credux + u.credux,
            lifetime_credux_earned = ub.lifetime_credux_earned + u.credux,
            gold_chest = ub.gold_chest + u.gold,
            boss_treasure_chest = ub.boss_treasure_chest + u.btc,
            boss_golden_chest = ub.boss_golden_chest + u.bgtc
       FROM unnest($1::varchar[], $2::bigint[], $3::int[], $4::int[], $5::int[])
              AS u(discord_id, credux, gold, btc, bgtc)
      WHERE ub.discord_id = u.discord_id
      RETURNING ub.discord_id, ub.credux, ub.gold_chest, ub.boss_treasure_chest, ub.boss_golden_chest`,
    [updIds, updCredux, updGold, updBtc, updBgtc]
  );
  const afterById = new Map(bag.rows.map((r) => [r.discord_id, r]));
  for (const [discordId, rewards] of out) {
    const after = afterById.get(discordId);
    if (!after) throw new Error(`grantCombatLevelRewardsMany: no users_bag row for ${discordId}`);
    await writeGameLogs(client, discordId, rewards, after);
  }
  return out;
}

module.exports = {
  grantCombatLevelRewards,
  grantBelieverLevelRewards,
  grantCombatLevelRewardsMany,
};
