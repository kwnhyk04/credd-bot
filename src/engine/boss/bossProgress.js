'use strict';

/**
 * bossProgress.js — boss spawn, reward distribution, attacks, and the
 * scheduler tick (Phase 2.4 split of bossSystem.js; bodies moved VERBATIM).
 *
 * The atomic-SQL invariants documented on bossSystem live with the code that
 * enforces them:
 *  - Spawn/defeat transitions are guarded in the WHERE clause, so overlapping
 *    ticks or button presses can never double-apply a transition.
 *  - Defeat distribution shares ONE transaction with the 'active'->'dead' flip;
 *    a crash rolls everything back and the next tick re-runs it. No double-pay.
 *  - Lock order everywhere: users_bag (sorted) -> user_character (sorted).
 *
 * Depends downward only (bossMessages -> bossRuntime -> bossRender); it must
 * never require the bossSystem facade, which would create a cycle.
 */

const pool = require('../../db/pool');
const {
  ContainerBuilder, ButtonBuilder, ButtonStyle,
  MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const guildConfig = require('../../handlers/guildConfigCache');
const { resolveBattle } = require('../battleEngine');
const {
  buildPlayerFighter, buildBossFighter, computeBossStats, fetchAllBosses, fetchMobByName,
} = require('../statAssembly');
const { logEmbeds, showPaginatedBattleLog } = require('../battleRender');
const { awardCombatExpMany } = require('../../utils/awardCombatExp');
const { formatLevelRewardLine } = require('../../config/levelRewards');
const { isBanned } = require('../../handlers/middleware');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emojiForDisplay } = require('../../utils/emojis');
const { grantTitles } = require('../../utils/titleGrant');
const { allocateRaidRewardLimits } = require('../../utils/raidRewardLimits');
const {
  envBool, envNumber, envPositiveInt, performanceLog,
} = require('../../utils/runtimeLogs');
const { beginActivity } = require('../../utils/networkTelemetry');
const { bossFeatTitlesFor } = require('../../config/titles');
const {
  isGreaterBoss, isCalamityBoss, bossRewards, bossBagReward, rollBossChest, hpMultiplierForChest,
  bossMaxHpForChest, inferChestFromGreaterHp, bossChestForSpawn,
  pickWeightedBoss, selectWeightedBossPool, pickBossFromPool,
  MAX_BOSS_ATTACKS_PER_DAY, bossAttackDecision,
} = require('../../config/bosses');
const {
  SUPREME_CHEST_REWARD,
  DIVINE_BAG_REWARD,
  rollCalamitySupremeRewards,
  grantedCalamityBonusRewards,
} = require('../calamityRewards');
const {
  bossRedirectMessage,
  isOfficialGuild,
  supportMarkdownLink,
} = require('../../config/officialSupport');
const {
  bossSlug, bossImagePath, bossBanner, bossStatusImage, bossCrit, trimBossBanners,
} = require('./bossRender');
const {
  liveMessages, logCache, currentSpawn, pendingBossRefreshes, lastBossReconciliations,
  greaterChests, devSpawns,
  chestForSpawn, rememberSpawn, rememberBossLog, bossLogKey, compactBossSim,
  clearPendingBossRefresh, purgeBossRuntimeForSpawn, purgeBossRuntimeForGuild,
  bossLogCacheMaxAttackers, bossLogCacheMaxEventsPerAttacker,
} = require('./bossRuntime');
const {
  fetchBossView, buildBossMessage, resolveAnnounceChannelId, postOfficialRedirect,
  postFreshLiveMessage, repointLiveMessage, deleteLiveMessage, refreshLiveMessage,
  refreshLiveMessageProgress, scheduleBossLiveRefresh, redirectChannelIssue,
  bossImageRefreshEnabled, bossDailyAttackLimit, devBossHasUnlimitedAttacks,
} = require('./bossMessages');

const RESPAWN_COOLDOWN = '15 minutes';   // spawns every 15 min after defeat

const RESPAWN_COOLDOWN_MS = 15 * 60_000;

const CALAMITY_CLAIM_TIMEOUT = '5 minutes';

const ACTIVE_BOSS_EXPIRES_AT_SQL = "NOW() + INTERVAL '100 years'";

const BOSS_REFRESH_RECONCILE_COOLDOWN_MS = 10 * 60_000;

const BOSS_STATE_COLUMNS = `
  guild_id, spawn_id, mob_id, max_hp, current_hp,
  scaled_atk, scaled_def, spawn_at, expires_at, status,
  spawn_source, last_attack_at, passive_state
`;

const MOB_BATTLE_COLUMNS = `
  mob_id, name, mythology, mob_type, base_hp, hp_per_level, base_atk,
  atk_per_level, base_def, def_per_level, base_crit, skill_key,
  skill_name, skill_description, immunity_tags, special_flags
`;

/**
 * Read the persistent portion of a tier's shuffled bag. Attack rows survive
 * process restarts without adding storage. Queued Calamities and the currently
 * visible direct dev spawn are excluded so identified developer controls do not
 * advance the natural rotation.
 */
async function fetchBossRotationState(db, guildId, bossPool) {
  const mobIds = bossPool.map((row) => Number(row.mob_id));
  if (mobIds.length === 0) return { recentMobIds: [], totalSpawns: 0 };

  const { rows } = await db.query(
    `WITH spawn_history AS (
       SELECT bal.boss_spawn_id, bal.mob_id, MAX(bal.attacked_at) AS last_seen_at
         FROM boss_attack_log bal
        WHERE bal.guild_id = $1
          AND bal.mob_id = ANY($2::int[])
          AND NOT EXISTS (
            SELECT 1
              FROM boss_spawn_queue q
             WHERE q.spawn_id = bal.boss_spawn_id
          )
          AND NOT EXISTS (
            SELECT 1
              FROM boss_state bs
             WHERE bs.guild_id = bal.guild_id
               AND bs.spawn_id = bal.boss_spawn_id
               AND bs.spawn_source = 'dev'
          )
        GROUP BY bal.boss_spawn_id, bal.mob_id
     ), ranked AS (
       SELECT boss_spawn_id, mob_id, last_seen_at, COUNT(*) OVER () AS total_spawns
         FROM spawn_history
     )
     SELECT mob_id, total_spawns
       FROM ranked
      ORDER BY last_seen_at DESC, boss_spawn_id DESC
      LIMIT $3`,
    [guildId, mobIds, mobIds.length]
  );

  return {
    recentMobIds: rows.map((row) => Number(row.mob_id)),
    totalSpawns: Number(rows[0]?.total_spawns || 0),
  };
}

async function processQueuedCalamity(client, guildId, { db = pool, spawn = spawnBoss } = {}) {
  const dbc = await db.connect();
  let queued = null;
  try {
    await dbc.query('BEGIN');
    await dbc.query(
      `UPDATE boss_spawn_queue
          SET status = 'pending', claim_started_at = NULL, updated_at = NOW()
        WHERE guild_id = $1
          AND status = 'spawning'
          AND (claim_started_at IS NULL OR claim_started_at <= NOW() - INTERVAL '${CALAMITY_CLAIM_TIMEOUT}')`,
      [guildId]
    );
    const result = await dbc.query(
      `WITH next_item AS (
         SELECT queue_id
           FROM boss_spawn_queue
          WHERE guild_id = $1 AND status = 'pending'
          ORDER BY created_at, queue_id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE boss_spawn_queue q
          SET status = 'spawning', claim_started_at = NOW(), updated_at = NOW()
         FROM next_item n
        WHERE q.queue_id = n.queue_id
        RETURNING q.queue_id, q.boss_name`,
      [guildId]
    );
    if (result.rows.length === 0) {
      await dbc.query('ROLLBACK');
      return false;
    }
    queued = result.rows[0];
    await dbc.query('COMMIT');
  } catch (err) {
    await dbc.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    dbc.release();
  }

  let spawned;
  try {
    spawned = await spawn(client, guildId, {
      force: false,
      bossName: queued.boss_name,
      spawnSource: 'dev',
      bypassOfficialGuard: true,
    });
  } catch (err) {
    await db.query(
      `UPDATE boss_spawn_queue
          SET status = 'pending', claim_started_at = NULL, updated_at = NOW()
        WHERE queue_id = $1 AND status = 'spawning'`,
      [queued.queue_id]
    ).catch(() => {});
    throw err;
  }
  if (spawned) {
    await db.query(
      `UPDATE boss_spawn_queue
          SET status = 'spawned', updated_at = NOW(), spawned_at = NOW(),
              claim_started_at = NULL,
              spawn_id = (SELECT spawn_id FROM boss_state WHERE guild_id = $1)
        WHERE queue_id = $2 AND status = 'spawning'`,
      [guildId, queued.queue_id]
    );
  } else {
    await db.query(
      `UPDATE boss_spawn_queue
          SET status = 'pending', claim_started_at = NULL, updated_at = NOW()
        WHERE queue_id = $1 AND status = 'spawning'`,
      [queued.queue_id]
    );
  }
  return spawned;
}

async function spawnBoss(client, guildId, {
  force = false, channelId = null, bossName = null, spawnSource = null,
  bypassOfficialGuard = false,
} = {}) {
  if (!bypassOfficialGuard && !isOfficialGuild(guildId)) {
    await postOfficialRedirect(client, guildId, channelId, { force });
    return false;
  }

  const announceChannelId = channelId || await resolveAnnounceChannelId(guildId);
  if (!announceChannelId) return false; // nowhere to announce — skip guild

  const eligible = await pool.query(
    `SELECT 1
       FROM user_guild_activity uga
       JOIN user_character uc ON uc.discord_id = uga.discord_id
      WHERE uga.guild_id = $1
      LIMIT 1`,
    [guildId]
  );
  if (eligible.rows.length === 0) return false;
  const source = spawnSource || (force ? 'dev' : 'natural');
  if (!['natural', 'dev'].includes(source)) return false;

  // Forced names use the roster row directly. Natural spawns keep the existing
  // weighted tier roll, then draw without replacement from that tier's bag.
  let pick;
  if (bossName) {
    const named = await fetchMobByName(pool, bossName);
    if (!named || named.mob_type !== 'boss') return false; // unknown boss name
    pick = {
      row: named,
      greater: isGreaterBoss(named.name),
      calamity: isCalamityBoss(named.name),
    };
  } else {
    const allBosses = await fetchAllBosses(pool);
    if (source === 'natural') {
      const bossPool = selectWeightedBossPool(allBosses);
      const rotationState = bossPool
        ? await fetchBossRotationState(pool, guildId, bossPool)
        : null;
      pick = pickBossFromPool(bossPool, rotationState || {});
    } else {
      // Unnamed development spawns retain the historical weighted random path.
      pick = pickWeightedBoss(allBosses);
    }
  }
  if (!pick) return false;
  const { row, greater, calamity } = pick;

  const stats = computeBossStats(row);
  // Select the fixed chest once so HP, announcement, and payout share one outcome.
  const spawnChest = greater || calamity ? bossChestForSpawn(row.name, source) : rollBossChest(row.name);
  const hpMultiplier = greater ? hpMultiplierForChest(spawnChest) : 1;
  const maxHp = bossMaxHpForChest(
    row.base_hp,
    row.hp_per_level,
    null,
    spawnChest,
    row.name,
  );
  performanceLog('boss stats resolved from database', {
    system: 'boss',
    command: 'boss',
    imageType: 'boss_status',
    guildId,
    source: `${source}:mob_roster`,
    greater,
    calamity,
    multiplier: hpMultiplier,
    reason: spawnChest ? `${spawnChest.column}:x${spawnChest.qty}` : 'normal',
    baseHp: Number(row.base_hp),
    baseAtk: Number(row.base_atk),
    baseDef: Number(row.base_def),
    baseCrit: Number(row.base_crit),
    finalHp: Number(maxHp),
    finalAtk: Number(stats.atk),
    finalDef: Number(stats.def),
    finalCrit: Number(stats.crit),
  });

  const ins = await pool.query(
    `INSERT INTO boss_state
       (guild_id, spawn_id, mob_id, max_hp, current_hp,
        scaled_atk, scaled_def, spawn_at, expires_at, status,
        spawn_source, last_attack_at, passive_state)
     VALUES ($1, gen_random_uuid(), $2, $3, $3, $4, $5,
             NOW(), ${ACTIVE_BOSS_EXPIRES_AT_SQL}, 'active', $6, NOW(), '{}'::jsonb)
     ON CONFLICT (guild_id) DO UPDATE SET
       spawn_id = gen_random_uuid(), mob_id = EXCLUDED.mob_id,
       max_hp = EXCLUDED.max_hp, current_hp = EXCLUDED.current_hp,
       scaled_atk = EXCLUDED.scaled_atk,
       scaled_def = EXCLUDED.scaled_def, spawn_at = NOW(),
       expires_at = ${ACTIVE_BOSS_EXPIRES_AT_SQL}, status = 'active',
       spawn_source = EXCLUDED.spawn_source, last_attack_at = NOW(), passive_state = '{}'::jsonb
     WHERE boss_state.status <> 'active'
       AND ($7 OR boss_state.expires_at <= NOW() - INTERVAL '${RESPAWN_COOLDOWN}')
     RETURNING spawn_id`,
    [guildId, row.mob_id, maxHp, stats.atk, stats.def, source, force]
  );
  if (ins.rows.length === 0) return false; // lost the race / cooldown not over

  // Stash the chest against the new spawn_id so HP, announcement, and payout
  // keep the same outcome without re-rolling.
  if (greater && spawnChest) greaterChests.set(ins.rows[0].spawn_id, spawnChest);

  if (source === 'dev') devSpawns.add(ins.rows[0].spawn_id); // test boss: attack rules bypassed
  rememberSpawn(guildId, ins.rows[0].spawn_id);
  const view = await fetchBossView(guildId);
  if (view) {
    await postFreshLiveMessage(
      client,
      guildId,
      await buildBossMessage(view, {
        phase: 'spawn',
        telemetryCommand: force ? 'dev:spawnboss' : 'scheduler:boss',
      }),
      announceChannelId
    );
  }
  return true;
}

async function distributeRewards(client, guildId, spawnId, { includeStatusImage = true } = {}) {
  const dbc = await pool.connect();
  let attackerIds = [];
  let reward = null;
  let chest = null;
  let bagReward = null;
  let supremeWinnerIds = [];
  let divineWinnerIds = [];
  let totalEligibleDamage = 0;
  let supremeBagUpd = { rows: [] };
  let divineBagUpd = { rows: [] };
  let bagUpd = { rows: [] };
  let expResults = new Map();
  try {
    await dbc.query('BEGIN');
    // expires_at = NOW() anchors the 15-min respawn clock (no died_at column)
    const flip = await dbc.query(
      `UPDATE boss_state SET status = 'dead', expires_at = NOW()
        WHERE guild_id = $1 AND spawn_id = $2 AND status = 'active' AND current_hp <= 0
        RETURNING mob_id, max_hp, spawn_source`,
      [guildId, spawnId]
    );
    if (flip.rows.length === 0) {
      await dbc.query('ROLLBACK');
      return null; // already distributed (or boss not actually down)
    }

    // Reward bundle + chest keyed off the boss's Greater identity. The chest was
    // fixed at spawn; after restart it is recovered from persisted max_hp.
    const mobRes = await dbc.query(
      `SELECT name, base_hp, hp_per_level, base_atk, atk_per_level,
              base_def, def_per_level, base_crit
         FROM mob_roster WHERE mob_id = $1`,
      [flip.rows[0].mob_id]
    );
    const mobRow = mobRes.rows[0] || {};
    const bossName = mobRow.name || '';
    const calamity = isCalamityBoss(bossName);
    // [v4.6] the chest fixed at spawn — same outcome the announcement showed, paid to all.
    chest = chestForSpawn(spawnId, bossName, {
      baseHp: mobRow.base_hp,
      hpPerLevel: mobRow.hp_per_level,
      maxHp: flip.rows[0].max_hp,
      spawnSource: flip.rows[0].spawn_source,
    }); // { column (whitelisted), qty, label }
    reward = bossRewards(bossName, chest);
    bagReward = bossBagReward(bossName, chest);

    const atk = await dbc.query(
      `SELECT discord_id, total_damage FROM boss_attack_log
        WHERE boss_spawn_id = $1 ORDER BY discord_id`,
      [spawnId]
    );
    const participantRows = calamity
      ? atk.rows.filter((row) => Number(row.total_damage) > 0)
      : atk.rows;
    attackerIds = participantRows.map((r) => r.discord_id);
    if (calamity) {
      const rolls = rollCalamitySupremeRewards(participantRows);
      totalEligibleDamage = rolls.totalEligibleDamage;
      supremeWinnerIds = rolls.supremeWinnerIds;
      divineWinnerIds = rolls.divineWinnerIds;
    }

    if (attackerIds.length > 0) {
      // lock order: users_bag (sorted) → user_character (sorted) — Phase-5
      // convention; the explicit sorted SELECT guarantees acquisition order
      await dbc.query(
        `SELECT discord_id FROM users_bag
          WHERE discord_id = ANY($1) ORDER BY discord_id FOR UPDATE`,
        [attackerIds]
      );
      // Boss participation is a raid source for the shared Belief Shard cap. Each
      // participant is allocated independently while bag rows remain locked in the
      // sorted attacker order. Boss-specific chest columns are intentionally outside
      // the Silver/Gold raid caps.
      for (const discordId of attackerIds) {
        const allocation = await allocateRaidRewardLimits(dbc, discordId, {
          beliefShards: reward.shards,
        });
        const rowRes = await dbc.query(
          `UPDATE users_bag
              SET credux = credux + $2,
                   belief_shards = belief_shards + $3,
                   lifetime_credux_earned = lifetime_credux_earned + $2,
                   ${chest.column} = ${chest.column} + $4,
                   ${bagReward.column} = ${bagReward.column} + $5
             WHERE discord_id = $1
             RETURNING discord_id, credux, belief_shards,
                       ${chest.column} AS chest_count,
                       ${bagReward.column} AS bag_count`,
          [discordId, reward.credux, allocation.granted.beliefShards, chest.qty, bagReward.qty]
        );
        if (rowRes.rows.length === 0) throw new Error(`missing reward bag row for ${discordId}`);
        rowRes.rows[0].granted_shards = allocation.granted.beliefShards;
        bagUpd.rows.push(rowRes.rows[0]);
      }

      if (calamity && supremeWinnerIds.length > 0) {
        supremeBagUpd = await dbc.query(
          `UPDATE users_bag
              SET supreme_chest = supreme_chest + $2
            WHERE discord_id = ANY($1)
            RETURNING discord_id, supreme_chest AS chest_count`,
          [supremeWinnerIds, SUPREME_CHEST_REWARD.qty]
        );
      }

      if (calamity && divineWinnerIds.length > 0) {
        divineBagUpd = await dbc.query(
          `UPDATE users_bag
              SET ${DIVINE_BAG_REWARD.column} = ${DIVINE_BAG_REWARD.column} + $2
            WHERE discord_id = ANY($1)
            RETURNING discord_id, ${DIVINE_BAG_REWARD.column} AS bag_count`,
          [divineWinnerIds, DIVINE_BAG_REWARD.qty]
        );
      }

      // Boss EXP scales off each attacker's own combat level, not the boss's fixed
      // combat stats.
      expResults = await awardCombatExpMany(dbc, attackerIds, reward.exp, {
        scaleByParticipantLevel: true,
      });

      // [v5 Phase 4] boss participation kill — boss died + you attacked (Blueprint §4.4)
      const killRes = await dbc.query(
        'UPDATE user_character SET boss_kills = boss_kills + 1 WHERE discord_id = ANY($1) RETURNING discord_id, boss_kills',
        [attackerIds]
      );
      // [v5 Phase 5] boss-feat titles at kill thresholds (idempotent).
      for (const row of killRes.rows) {
        await grantTitles(dbc, row.discord_id, bossFeatTitlesFor(row.boss_kills));
      }

      // game_logs — one row per currency/item per attacker (action 'Boss'),
      // before/after balances, bulk via unnest
      const ids = [], prevCred = [], newCred = [], prevSh = [], newSh = [];
      const prevCh = [], newCh = [], prevBag = [], newBag = [];
      for (const r of bagUpd.rows) {
        ids.push(r.discord_id);
        newCred.push(Number(r.credux));
        prevCred.push(Number(r.credux) - reward.credux);
        newSh.push(r.belief_shards);
        prevSh.push(r.belief_shards - r.granted_shards);
        newCh.push(r.chest_count);
        prevCh.push(r.chest_count - chest.qty);
        newBag.push(r.bag_count);
        prevBag.push(r.bag_count - bagReward.qty);
      }
      await dbc.query(
        `INSERT INTO game_logs (discord_id, action, previous_credux, updated_credux)
         SELECT u.id, 'Boss', u.prev, u.upd
           FROM unnest($1::varchar[], $2::bigint[], $3::bigint[]) AS u(id, prev, upd)`,
        [ids, prevCred, newCred]
      );
      await dbc.query(
        `INSERT INTO game_logs (discord_id, action, previous_belief_shards, updated_belief_shards)
         SELECT u.id, 'Boss', u.prev, u.upd
           FROM unnest($1::varchar[], $2::int[], $3::int[]) AS u(id, prev, upd)`,
        [ids, prevSh, newSh]
      );
      await dbc.query(
        `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
          SELECT u.id, 'Boss', $4, u.prev, u.upd
            FROM unnest($1::varchar[], $2::int[], $3::int[]) AS u(id, prev, upd)`,
        [ids, prevCh, newCh, chest.column]
      );
      await dbc.query(
        `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
          SELECT u.id, 'Boss', $4, u.prev, u.upd
            FROM unnest($1::varchar[], $2::int[], $3::int[]) AS u(id, prev, upd)`,
        [ids, prevBag, newBag, bagReward.column]
      );

      if (supremeBagUpd.rows.length > 0) {
        const supremeIds = [], previousSupreme = [], updatedSupreme = [];
        for (const row of supremeBagUpd.rows) {
          supremeIds.push(row.discord_id);
          updatedSupreme.push(row.chest_count);
          previousSupreme.push(row.chest_count - SUPREME_CHEST_REWARD.qty);
        }
        await dbc.query(
          `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
           SELECT u.id, 'Boss', $4, u.prev, u.upd
             FROM unnest($1::varchar[], $2::int[], $3::int[]) AS u(id, prev, upd)`,
          [supremeIds, previousSupreme, updatedSupreme, SUPREME_CHEST_REWARD.column]
        );
      }

      if (divineBagUpd.rows.length > 0) {
        const divineIds = [], previousDivine = [], updatedDivine = [];
        for (const row of divineBagUpd.rows) {
          divineIds.push(row.discord_id);
          updatedDivine.push(row.bag_count);
          previousDivine.push(row.bag_count - DIVINE_BAG_REWARD.qty);
        }
        await dbc.query(
          `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
           SELECT u.id, 'Boss', $4, u.prev, u.upd
             FROM unnest($1::varchar[], $2::int[], $3::int[]) AS u(id, prev, upd)`,
          [divineIds, previousDivine, updatedDivine, DIVINE_BAG_REWARD.column]
        );
      }
    }

    await dbc.query('COMMIT');
  } catch (err) {
    await dbc.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    dbc.release();
  }

  // post-commit presentation (failures here never affect the payouts)
  await clearPendingBossRefresh(guildId, 'dead');
  await refreshLiveMessage(client, guildId, {
    includeStatusImage,
    includeBanner: 'remote-only',
    phase: 'final',
    telemetryCommand: 'boss:final',
    bonusRewardResults: { supremeWinnerIds, divineWinnerIds },
  }).catch(() => {});
  const view = await fetchBossView(guildId).catch(() => null);
  if (view && isCalamityBoss(view.mobRow.name) && totalEligibleDamage <= 0) {
    console.info('[boss] calamity defeated without eligible damage', {
      guildId,
      spawnId,
      reason: 'total eligible damage is zero',
    });
  }
  if (view) {
    const channelId = liveMessages.get(guildId)?.channelId || await resolveAnnounceChannelId(guildId);
    const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (channel) {
      // Recover the fixed variant if presentation resumes after a process restart.
      const c = chest || chestForSpawn(view.state.spawn_id, view.mobRow.name, {
        baseHp: view.mobRow.base_hp,
        hpPerLevel: view.mobRow.hp_per_level,
        maxHp: view.state.max_hp,
        spawnSource: view.state.spawn_source,
      });
      const r = reward || bossRewards(view.mobRow.name, c);
      const guaranteedBag = bagReward || bossBagReward(view.mobRow.name, c);
      const greater = isGreaterBoss(view.mobRow.name);
      const grantedBonuses = grantedCalamityBonusRewards({ supremeWinnerIds, divineWinnerIds });
      const bonusSummary = grantedBonuses.length > 0
        ? ` Bonus Rewards: ${grantedBonuses.map((item) =>
          `**${item.winnerCount}** challenger${item.winnerCount === 1 ? '' : 's'} received ` +
          `${item.qty}× ${item.label}`
        ).join(' · ')}.`
        : '';
      // Grouped level-up + level-reward summary (spec S3) from the same
      // distribution transaction — post-commit display only.
      let levelLine = '';
      {
        const leveled = [...expResults.values()].filter((i) => i.levelsGained > 0);
        if (leveled.length > 0) {
          const totals = { credux: 0, chests: {} };
          for (const info of leveled) {
            if (!info.rewards) continue;
            totals.credux += info.rewards.credux;
            for (const [col, qty] of Object.entries(info.rewards.chests)) {
              totals.chests[col] = (totals.chests[col] || 0) + qty;
            }
          }
          const rewardsText = formatLevelRewardLine(totals);
          levelLine =
            `\n⬆️ **${leveled.length}** challenger${leveled.length === 1 ? '' : 's'} leveled up!` +
            (rewardsText ? ` Level Rewards: ${rewardsText}` : '');
        }
      }
      await channel.send({
        // Calamity bonuses are independent per valid damage participant. Failed
        // bonus rolls stay hidden; successful item counts are reported separately.
        content:
          `🎉 ${greater ? '☠️ **GREATER** ' : ''}**${view.mobRow.name}** has fallen! ` +
          `All **${attackerIds.length}** challenger${attackerIds.length === 1 ? '' : 's'} receive: ` +
          `${r.credux.toLocaleString()} Credux · ${r.exp.toLocaleString()} Combat EXP · ${c.qty}× ${c.label} · ` +
          `${guaranteedBag.qty}× ${guaranteedBag.label} · ` +
          `${r.shards.toLocaleString()} Belief Shards.` +
          (isCalamityBoss(view.mobRow.name) ? bonusSummary : '') +
          levelLine,
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
  }
  purgeBossRuntimeForSpawn(spawnId, 'dead');
  currentSpawn.delete(guildId);
  lastBossReconciliations.delete(guildId);
  return attackerIds.length;
}

async function handleAttackImpl(interaction) {
  const guildId = interaction.guildId;
  const discordId = interaction.user.id;
  const started = Date.now();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const fail = (msg) => interaction.editReply({ content: msg }).catch(() => {});

  try {
    // Read the persisted source before applying the official-server rule. A
    // dev-spawned boss is an explicit local test fixture and must remain
    // attackable wherever it was created, including dev-spawned Calamities.
    const stRes = await pool.query(`SELECT ${BOSS_STATE_COLUMNS} FROM boss_state WHERE guild_id = $1`, [guildId]);
    const state = stRes.rows[0];
    if (!isOfficialGuild(guildId) && state?.spawn_source !== 'dev') {
      return fail(`Monster bosses are currently hosted in the official support server: ${supportMarkdownLink()}.`);
    }
    // gate 1 — registered + character
    const fighter = await buildPlayerFighter(pool, discordId);
    if (!fighter) {
      return fail('You need a character first — `crd register`, then `crd create character`.');
    }
    // gate 2 — not banned (buttons bypass message middleware)
    if (await isBanned(discordId)) {
      return fail('You cannot attack the boss right now.');
    }
    // gate 3 — boss still active
    if (!state || state.status !== 'active') {
      return fail('There is no active boss right now — it has fallen. `crd boss` shows the latest status.');
    }
    // Ordinary dev test bosses bypass the daily lock. Dev Calamities use the
    // regular per-player cap, matching a naturally spawned Calamity.
    const mobRes = await pool.query(`SELECT ${MOB_BATTLE_COLUMNS} FROM mob_roster WHERE mob_id = $1`, [state.mob_id]);
    const mobRow = mobRes.rows[0];
    if (!mobRow) return fail('Boss data is missing — try again shortly.');
    let unlimitedDev = devBossHasUnlimitedAttacks(state, mobRow);
    if (!unlimitedDev) {
      // Gate 4: global daily limit (PHT clock). A player may attack up to
      // MAX_BOSS_ATTACKS_PER_DAY times/day across all boss spawns.
      const dailyLimit = bossDailyAttackLimit();
      const dl = await pool.query(
        `SELECT COALESCE(SUM(attacks), 0)::int AS used
           FROM boss_attack_log
          WHERE discord_id = $1
            AND last_daily_reset = (NOW() AT TIME ZONE 'Asia/Manila')::date`,
        [discordId]
      );
      const usedToday = Number(dl.rows[0]?.used || 0);
      const decision = bossAttackDecision({ usedToday, limit: dailyLimit });
      if (!decision.allowed) {
        return fail(`You already used all ${dailyLimit} boss attacks today — your attacks reset at midnight PHT.`);
      }
    }
    // gate 6 — no live battle: claim the active_battles slot (reaper covers crashes)
    const claim = await pool.query(
      `INSERT INTO active_battles
         (discord_id, channel_id, message_id, battle_type, mob_id,
          player_hp, player_max_hp, enemy_hp, enemy_max_hp, current_turn, player_goes_first)
       VALUES ($1, $2, '0', 'boss', $3, $4, $4, $5, $6, 1, TRUE)
       ON CONFLICT (discord_id) DO NOTHING
       RETURNING battle_id`,
      [
        discordId, interaction.channelId, state.mob_id,
        fighter.hp, Number(state.current_hp), Number(state.max_hp),
      ]
    );
    if (claim.rows.length === 0) {
      return fail('⚔️ You are already in a battle — wait for it to finish.');
    }

    let dbc = null;
    let txOpen = false;
    try {
      // fresh pool snapshot at fight start — concurrent attackers may have
      // chipped it since the gate; "enemy HP < X%" passives read pool % (§35.4)
      dbc = await pool.connect();
      let remaining = null;
      let sim = null;
      let net = 0;
      await dbc.query('BEGIN');
      txOpen = true;
      const locked = await dbc.query(
        `SELECT ${BOSS_STATE_COLUMNS} FROM boss_state
          WHERE guild_id = $1 AND spawn_id = $2
          FOR UPDATE`,
        [guildId, state.spawn_id]
      );
      if (locked.rows.length === 0 || locked.rows[0].status !== 'active' || Number(locked.rows[0].current_hp) <= 0) {
        await dbc.query('ROLLBACK');
        txOpen = false;
        dbc.release();
        dbc = null;
        return fail('The boss just fell before your strike landed!');
      }
      Object.assign(state, locked.rows[0]);
      unlimitedDev = devBossHasUnlimitedAttacks(state, mobRow);
      const boss = { ...buildBossFighter(mobRow, state), crit: bossCrit(mobRow) };
      sim = resolveBattle(fighter, boss, { mode: 'boss', seed: Date.now() >>> 0 });
      net = Math.max(0, Math.floor(sim.totals.netDamage));

      // atomic commit — pool deduction, attack log, daily lock
      try {
        const upd = await dbc.query(
          `UPDATE boss_state SET current_hp = GREATEST(current_hp - $3, 0),
                last_attack_at = NOW(), passive_state = $4::jsonb
            WHERE guild_id = $1 AND spawn_id = $2 AND status = 'active' AND current_hp > 0
            RETURNING current_hp`,
          [guildId, state.spawn_id, net, JSON.stringify(sim.b?.bossPassiveState || {})]
        );
        if (upd.rows.length === 0) {
          await dbc.query('ROLLBACK');
          return fail('The boss just fell before your strike landed!'); // daily lock NOT consumed
        }
        // The per-spawn row keeps lifetime damage while attacks tracks the current
        // PHT day. The conflict guard is a backstop for the daily limit.
        const ins = await dbc.query(
          `INSERT INTO boss_attack_log
             (boss_spawn_id, guild_id, discord_id, mob_id, total_damage, attacks, last_daily_reset)
           VALUES ($1, $2, $3, $4, $5, 1, (NOW() AT TIME ZONE 'Asia/Manila')::date)
           ON CONFLICT (boss_spawn_id, discord_id) DO UPDATE SET
             attacks = CASE
               WHEN boss_attack_log.last_daily_reset = (NOW() AT TIME ZONE 'Asia/Manila')::date
                 THEN boss_attack_log.attacks + 1
               ELSE 1
             END,
             total_damage = boss_attack_log.total_damage + EXCLUDED.total_damage,
             attacked_at = NOW(),
             last_daily_reset = (NOW() AT TIME ZONE 'Asia/Manila')::date
           ${unlimitedDev ? '' : "WHERE boss_attack_log.last_daily_reset <> (NOW() AT TIME ZONE 'Asia/Manila')::date OR boss_attack_log.attacks < $6"}
           RETURNING id`,
          unlimitedDev
            ? [state.spawn_id, guildId, discordId, state.mob_id, net]
            : [state.spawn_id, guildId, discordId, state.mob_id, net, bossDailyAttackLimit()]
        );
        if (ins.rows.length === 0) {
          await dbc.query('ROLLBACK');
          return fail(`You already used all ${bossDailyAttackLimit()} boss attacks today — your attacks reset at midnight PHT.`);
        }
        // [v5 Phase 5b] track highest single-attack boss damage (leaderboard metric)
        await dbc.query(
          'UPDATE user_character SET boss_top_damage = GREATEST(boss_top_damage, $2) WHERE discord_id = $1',
          [discordId, net]
        );
        if (!unlimitedDev) {
          // Only ordinary dev test bosses skip the global daily lock.
          await dbc.query(
            `UPDATE users SET last_boss_attack_date = (NOW() AT TIME ZONE 'Asia/Manila')::date
              WHERE discord_id = $1`,
            [discordId]
          );
        }
        await dbc.query('COMMIT');
        txOpen = false;
        remaining = Number(upd.rows[0].current_hp);
      } catch (err) {
        await dbc.query('ROLLBACK').catch(() => {});
        txOpen = false;
        throw err;
      } finally {
        dbc.release();
        dbc = null;
      }

      rememberBossLog(state.spawn_id, discordId, sim);
      rememberSpawn(guildId, state.spawn_id);

      // The attack transaction is committed. Refresh the live HP/leaderboard
      // immediately; scheduler reconciliation keeps its normal debounce.
      if (remaining > 0) {
        await scheduleBossLiveRefresh(interaction.client, guildId, {
          spawnId: state.spawn_id,
          immediate: true,
        });
      }

      if (sim.bossThresholdEvents?.length) {
        const channelId = liveMessages.get(guildId)?.channelId || await resolveAnnounceChannelId(guildId);
        const channel = channelId ? await interaction.client.channels.fetch(channelId).catch(() => null) : null;
        if (channel) {
          for (const event of sim.bossThresholdEvents) {
            await channel.send({
              content: `☄️ **Bakunawa** crosses ${event.threshold}% HP. Seven Moons raises its ATK to ${Math.round(event.atkBonusPct * 100)}%.`,
              allowedMentions: { parse: [] },
            }).catch(() => {});
          }
        }
      }

      if (remaining <= 0) {
        await distributeRewards(interaction.client, guildId, state.spawn_id);
      }

      const survived = sim.outcome === 'boss_timeout';
      await interaction.editReply({
        content:
          `You dealt **${net.toLocaleString()}** damage to **${mobRow.name}**` +
          `${survived ? ' and survived all 50 rounds!' : '!'} Tap 📋 Log for the blow-by-blow.`,
      }).catch(() => {});
    } catch (err) {
      if (dbc) {
        if (txOpen) await dbc.query('ROLLBACK').catch(() => {});
        dbc.release();
        dbc = null;
      }
      throw err;
    } finally {
      await pool.query('DELETE FROM active_battles WHERE discord_id = $1', [discordId])
        .catch(() => {});
    }
  } catch (err) {
    console.error('[boss] attack error:', err);
    await fail('Something went wrong with your attack — nothing was consumed.');
  } finally {
    performanceLog('boss attack total duration', {
      system: 'boss',
      command: 'boss:attack',
      guildId,
      userId: discordId,
      durationMs: Date.now() - started,
    });
  }
}

async function handleAttack(interaction) {
  const endActivity = beginActivity('battle.boss');
  try {
    return await handleAttackImpl(interaction);
  } finally {
    endActivity();
  }
}

async function handleLog(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const st = await pool.query(
      'SELECT spawn_id FROM boss_state WHERE guild_id = $1', [interaction.guildId]
    );
    const spawnId = st.rows[0]?.spawn_id;
    const sim = spawnId ? logCache.get(`${spawnId}:${interaction.user.id}`) : null;
    if (!sim) {
      await interaction.editReply({
        content: "You haven't attacked this boss yet.",
      });
      return;
    }
    const pages = logEmbeds(sim);
    await showPaginatedBattleLog(interaction, pages);
  } catch (err) {
    console.error('[boss] log error:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: 'Could not load the boss log right now.' }).catch(() => {});
    }
  }
}

async function tickGuild(client, guildId, { forceRefresh = false } = {}) {
  const stRes = await pool.query(`SELECT ${BOSS_STATE_COLUMNS} FROM boss_state WHERE guild_id = $1`, [guildId]);
  const state = stRes.rows[0] || null;
  const devBossActive = state?.status === 'active' && state?.spawn_source === 'dev';

  // Keep natural lifecycle/spawn traffic official-only, but allow the
  // scheduler to reconcile and recover an explicitly dev-spawned test boss in
  // any guild. A terminal dev row must not cause a new natural spawn there.
  if (!isOfficialGuild(guildId) && !devBossActive) {
    await postOfficialRedirect(client, guildId);
    return;
  }

  if (state && state.status === 'active') {
    if (Number(state.current_hp) <= 0) {
      // crash-recovery safety net: distribution didn't finish — re-run it
      await distributeRewards(client, guildId, state.spawn_id);
      return;
    }
    rememberSpawn(guildId, state.spawn_id);
    // The startup scheduler pass explicitly refreshes the active boss so a
    // deployment immediately upgrades the live payload (footer, buttons, and
    // status image). Normal minute ticks only reconcile missing messages.
    if ((forceRefresh || !liveMessages.has(guildId)) && !pendingBossRefreshes.has(guildId)) {
      const now = Date.now();
      const lastAttempt = lastBossReconciliations.get(guildId) || 0;
      if (forceRefresh || now - lastAttempt >= BOSS_REFRESH_RECONCILE_COOLDOWN_MS) {
        lastBossReconciliations.set(guildId, now);
        scheduleBossLiveRefresh(client, guildId, {
          spawnId: state.spawn_id,
          telemetryCommand: forceRefresh ? 'scheduler:deployment-refresh' : 'scheduler:boss',
        });
        bandwidthLog('boss live message reconciliation scheduled', {
          system: 'boss',
          command: 'scheduler:boss',
          imageType: 'boss_status',
          guildId,
          spawnId: state.spawn_id,
          cooldownMs: BOSS_REFRESH_RECONCILE_COOLDOWN_MS,
        });
      }
    }
    return;
  }

  // no row, or terminal state — the spawn UPSERT's WHERE enforces the 15-min rule
  if (state && new Date(state.expires_at).getTime() + RESPAWN_COOLDOWN_MS > Date.now()) {
    return;
  }
  if (await processQueuedCalamity(client, guildId)) return;
  await spawnBoss(client, guildId);
}

module.exports = {
  processQueuedCalamity,
  spawnBoss,
  distributeRewards,
  handleAttackImpl,
  handleAttack,
  handleLog,
  tickGuild,
};
