'use strict';

const {
  MONTHSARY_EVENT,
  eventStateAt,
  attendanceRewardForDay,
} = require('../config/monthsaryEvent');

const QUEST_SAVEPOINT = 'monthsary_quest_claim';

async function resolveEventState(client, { now = null, config = MONTHSARY_EVENT } = {}) {
  if (!config.enabled) return { active: false, reason: 'disabled', eventDay: null };
  if (!config.valid) return { active: false, reason: 'invalid', eventDay: null };

  let instant = now;
  if (instant == null) {
    const result = await client.query('SELECT NOW() AS event_now');
    instant = result.rows[0]?.event_now;
  }
  return eventStateAt(instant, config);
}

async function logRelicGrant(client, userId, action, previous, updated) {
  await client.query(
    `INSERT INTO game_logs
       (discord_id, action, item_type, previous_relic_count, updated_relic_count)
     VALUES ($1, $2, 'sacred_relics', $3, $4)`,
    [userId, action, previous, updated]
  );
}

async function logChestGrant(client, userId, action, itemType, previous, updated) {
  await client.query(
    `INSERT INTO game_logs
       (discord_id, action, item_type, previous_chest_count, updated_chest_count)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, itemType, previous, updated]
  );
}

async function claimEventAttendance(client, userId, options = {}) {
  const config = options.config || MONTHSARY_EVENT;
  const state = await resolveEventState(client, { ...options, config });
  if (!state.active) return { status: 'inactive', reason: state.reason };

  const guard = await client.query(
    `INSERT INTO event_attendance (event_key, user_id, event_day)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING event_day`,
    [config.eventKey, userId, state.eventDay]
  );
  if (guard.rows.length === 0) return { status: 'already', eventDay: state.eventDay };

  const reward = attendanceRewardForDay(state.eventDay, config);
  const bag = await client.query(
    `UPDATE users_bag
        SET sacred_relics = sacred_relics + $2,
            boss_treasure_chest = boss_treasure_chest + $3,
            boss_golden_chest = boss_golden_chest + $4
      WHERE discord_id = $1
      RETURNING sacred_relics, boss_treasure_chest, boss_golden_chest`,
    [
      userId,
      reward.sacredRelics,
      reward.bossTreasureChests,
      reward.bossGoldenChests,
    ]
  );
  if (bag.rows.length !== 1) throw new Error('monthsary attendance bag row missing');

  const after = bag.rows[0];
  await logRelicGrant(
    client, userId, 'MonthsaryAttendance',
    Number(after.sacred_relics) - reward.sacredRelics,
    Number(after.sacred_relics)
  );
  await logChestGrant(
    client, userId, 'MonthsaryAttendance', 'boss_treasure_chest',
    Number(after.boss_treasure_chest) - reward.bossTreasureChests,
    Number(after.boss_treasure_chest)
  );
  if (reward.bossGoldenChests > 0) {
    await logChestGrant(
      client, userId, 'MonthsaryAttendance', 'boss_golden_chest',
      Number(after.boss_golden_chest) - reward.bossGoldenChests,
      Number(after.boss_golden_chest)
    );
  }

  return { status: 'ok', eventDay: state.eventDay, ...reward };
}

async function recoverQuestSavepoint(client, err, userId, eventDay) {
  try {
    await client.query(`ROLLBACK TO SAVEPOINT ${QUEST_SAVEPOINT}`);
    await client.query(`RELEASE SAVEPOINT ${QUEST_SAVEPOINT}`);
  } catch (recoveryErr) {
    console.error(
      `[monthsary quest] savepoint recovery failed user=${userId} day=${eventDay ?? 'unknown'}:`,
      recoveryErr.message
    );
    recoveryErr.cause = err;
    throw recoveryErr;
  }
  console.error(
    `[monthsary quest] claim failed user=${userId} day=${eventDay ?? 'unknown'}:`,
    err.message
  );
  return { status: 'error', eventDay: eventDay ?? null };
}

async function claimEventQuestDay(client, userId, options = {}) {
  const config = options.config || MONTHSARY_EVENT;
  if (!config.enabled) return { status: 'inactive', reason: 'disabled' };
  if (!config.valid) return { status: 'inactive', reason: 'invalid' };

  await client.query(`SAVEPOINT ${QUEST_SAVEPOINT}`);
  let state = null;
  try {
    state = await resolveEventState(client, { ...options, config });
    if (!state.active) {
      await client.query(`RELEASE SAVEPOINT ${QUEST_SAVEPOINT}`);
      return { status: 'inactive', reason: state.reason };
    }

    const progress = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE completed)::int AS completed
         FROM daily_quests
        WHERE discord_id = $1
          AND quest_date = ($2::timestamptz AT TIME ZONE 'Asia/Manila')::date`,
      [userId, state.now.toISOString()]
    );
    const total = Number(progress.rows[0]?.total || 0);
    const completed = Number(progress.rows[0]?.completed || 0);
    if (total !== 3 || completed !== 3) {
      await client.query(`RELEASE SAVEPOINT ${QUEST_SAVEPOINT}`);
      return { status: 'incomplete', eventDay: state.eventDay, total, completed };
    }

    const guard = await client.query(
      `INSERT INTO event_quest_claims (event_key, user_id, event_day)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING event_day`,
      [config.eventKey, userId, state.eventDay]
    );
    if (guard.rows.length === 0) {
      await client.query(`RELEASE SAVEPOINT ${QUEST_SAVEPOINT}`);
      return { status: 'already', eventDay: state.eventDay };
    }

    const relics = Number(config.questReward.sacredRelics);
    const bag = await client.query(
      `UPDATE users_bag
          SET sacred_relics = sacred_relics + $2
        WHERE discord_id = $1
        RETURNING sacred_relics`,
      [userId, relics]
    );
    if (bag.rows.length !== 1) throw new Error('monthsary quest bag row missing');

    const after = Number(bag.rows[0].sacred_relics);
    await logRelicGrant(client, userId, 'MonthsaryQuest', after - relics, after);
    await client.query(`RELEASE SAVEPOINT ${QUEST_SAVEPOINT}`);
    return {
      status: 'ok',
      eventDay: state.eventDay,
      sacredRelics: relics,
      notice: `Monthsary Event: all daily quests complete - +${relics} Sacred Relic`,
    };
  } catch (err) {
    return recoverQuestSavepoint(client, err, userId, state?.eventDay);
  }
}

module.exports = {
  QUEST_SAVEPOINT,
  resolveEventState,
  claimEventAttendance,
  claimEventQuestDay,
};
