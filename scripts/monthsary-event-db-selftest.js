'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { buildEventConfig } = require('../src/config/monthsaryEvent');
const {
  claimEventAttendance,
  claimEventQuestDay,
} = require('../src/engine/monthsaryEvent');
const { claimDaily } = require('../src/commands/economy/daily');

const START = '2026-08-10T00:00:00+08:00';
const NOW = new Date('2026-08-10T12:00:00+08:00');
const CONFIG = buildEventConfig({ enabled: true, startAt: START });
const EVENT_KEY = CONFIG.eventKey;

function testDatabaseUrl() {
  const raw = process.env.MONTHSARY_EVENT_TEST_DATABASE_URL;
  if (!raw) throw new Error('MONTHSARY_EVENT_TEST_DATABASE_URL is required');
  if (process.env.DATABASE_URL && raw === process.env.DATABASE_URL) {
    throw new Error('refusing to run against DATABASE_URL');
  }
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('monthsary DB selftest requires a loopback PostgreSQL server');
  }
  if (!url.pathname.toLowerCase().includes('monthsary_event_test')) {
    throw new Error('test database name must contain monthsary_event_test');
  }
  return raw;
}

function withTimeout(promise, ms = 5_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('database concurrency test timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function createBaseSchema(db) {
  await db.query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    CREATE TABLE public.users (
      discord_id varchar(20) PRIMARY KEY,
      monthly_streak integer NOT NULL DEFAULT 0,
      overall_streak integer NOT NULL DEFAULT 0,
      last_daily_claim_date date
    );
    CREATE TABLE public.users_bag (
      discord_id varchar(20) PRIMARY KEY REFERENCES public.users(discord_id) ON DELETE CASCADE,
      credux integer NOT NULL DEFAULT 0,
      belief_shards integer NOT NULL DEFAULT 0,
      lifetime_credux_earned bigint NOT NULL DEFAULT 0,
      silver_chest integer NOT NULL DEFAULT 0,
      gold_chest integer NOT NULL DEFAULT 0,
      sacred_relics integer NOT NULL DEFAULT 0,
      boss_treasure_chest integer NOT NULL DEFAULT 0,
      boss_golden_chest integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.daily_quests (
      id bigserial PRIMARY KEY,
      discord_id varchar(20) NOT NULL REFERENCES public.users(discord_id) ON DELETE CASCADE,
      quest_date date NOT NULL,
      completed boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.game_logs (
      id bigserial PRIMARY KEY,
      discord_id varchar(20) NOT NULL,
      action text NOT NULL,
      item_type text,
      previous_credux bigint,
      updated_credux bigint,
      previous_belief_shards integer,
      updated_belief_shards integer,
      previous_chest_count integer,
      updated_chest_count integer,
      previous_relic_count integer,
      updated_relic_count integer
    );
  `);
}

async function testFirstDailyClaim(db) {
  const userId = 'event_first_daily';
  await seedReadyUser(db, userId);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const daily = await claimDaily(client, userId);
    assert.equal(daily.status, 'ok');
    const attendance = await claimEventAttendance(client, userId, { config: CONFIG, now: NOW });
    assert.equal(attendance.status, 'ok');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const final = await db.query(
    `SELECT u.monthly_streak, u.overall_streak,
            u.last_daily_claim_date IS NOT NULL AS claimed,
            b.credux, b.belief_shards, b.silver_chest,
            b.sacred_relics, b.boss_treasure_chest
       FROM users u JOIN users_bag b ON b.discord_id = u.discord_id
      WHERE u.discord_id = $1`,
    [userId]
  );
  assert.deepEqual(final.rows[0], {
    monthly_streak: 1,
    overall_streak: 1,
    claimed: true,
    credux: 1000,
    belief_shards: 3,
    silver_chest: 1,
    sacred_relics: 1,
    boss_treasure_chest: 1,
  });
}

async function seedReadyUser(db, userId) {
  await db.query('INSERT INTO users (discord_id) VALUES ($1)', [userId]);
  await db.query('INSERT INTO users_bag (discord_id) VALUES ($1)', [userId]);
  await db.query(
    `INSERT INTO daily_quests (discord_id, quest_date, completed)
     SELECT $1, DATE '2026-08-10', true FROM generate_series(1, 3)`,
    [userId]
  );
}

async function testMigration(db) {
  const migration = fs.readFileSync(
    path.join(__dirname, 'migrations', '20260804_01_monthsary_event.sql'),
    'utf8'
  );
  const verify = fs.readFileSync(
    path.join(__dirname, 'migrations', '20260804_01_monthsary_event_verify.sql'),
    'utf8'
  );
  await db.query(migration);
  await db.query(migration);
  await db.query(verify);
}

async function testCrossPathConcurrency(db) {
  const userId = 'event_concurrency';
  await seedReadyUser(db, userId);
  const daily = await db.connect();
  const quest = await db.connect();
  try {
    await daily.query('BEGIN');
    await daily.query("SET LOCAL lock_timeout = '4s'");
    await daily.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [userId]);

    const questWork = (async () => {
      await quest.query('BEGIN');
      await quest.query("SET LOCAL lock_timeout = '4s'");
      await quest.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [userId]);
      const result = await claimEventQuestDay(quest, userId, { config: CONFIG, now: NOW });
      await quest.query('COMMIT');
      return result;
    })();

    const attendance = await claimEventAttendance(daily, userId, { config: CONFIG, now: NOW });
    await daily.query('COMMIT');
    const questResult = await withTimeout(questWork);
    assert.equal(attendance.status, 'ok');
    assert.equal(questResult.status, 'ok');

    const final = await db.query(
      `SELECT sacred_relics, boss_treasure_chest, boss_golden_chest
         FROM users_bag WHERE discord_id = $1`,
      [userId]
    );
    assert.deepEqual(final.rows[0], {
      sacred_relics: 2,
      boss_treasure_chest: 1,
      boss_golden_chest: 0,
    });
    const guards = await db.query(
      `SELECT
         (SELECT count(*)::int FROM event_attendance WHERE user_id = $1) AS attendance,
         (SELECT count(*)::int FROM event_quest_claims WHERE user_id = $1) AS quest`,
      [userId]
    );
    assert.deepEqual(guards.rows[0], { attendance: 1, quest: 1 });
  } catch (err) {
    await daily.query('ROLLBACK').catch(() => {});
    await quest.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    daily.release();
    quest.release();
  }
}

async function installRelicFailureTrigger(db) {
  await db.query(`
    CREATE OR REPLACE FUNCTION public.monthsary_test_fail_relic()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.discord_id IN ('event_quest_failure', 'event_daily_failure')
         AND NEW.sacred_relics > OLD.sacred_relics THEN
        RAISE EXCEPTION 'injected relic update failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER monthsary_test_fail_relic
      BEFORE UPDATE ON public.users_bag
      FOR EACH ROW EXECUTE FUNCTION public.monthsary_test_fail_relic();
  `);
}

async function removeRelicFailureTrigger(db) {
  await db.query('DROP TRIGGER IF EXISTS monthsary_test_fail_relic ON public.users_bag');
  await db.query('DROP FUNCTION IF EXISTS public.monthsary_test_fail_relic()');
}

async function testQuestFailureContainment(db) {
  const userId = 'event_quest_failure';
  await seedReadyUser(db, userId);
  await installRelicFailureTrigger(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [userId]);
    await client.query(
      'UPDATE users_bag SET credux = 3000, belief_shards = 5 WHERE discord_id = $1',
      [userId]
    );
    const result = await claimEventQuestDay(client, userId, { config: CONFIG, now: NOW });
    assert.equal(result.status, 'error');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await removeRelicFailureTrigger(db);
  }

  const final = await db.query(
    `SELECT credux, belief_shards, sacred_relics FROM users_bag WHERE discord_id = $1`,
    [userId]
  );
  assert.deepEqual(final.rows[0], { credux: 3000, belief_shards: 5, sacred_relics: 0 });
  const guard = await db.query(
    'SELECT count(*)::int AS count FROM event_quest_claims WHERE user_id = $1',
    [userId]
  );
  assert.equal(guard.rows[0].count, 0);
}

async function testAttendanceFailureRollsBackDaily(db) {
  const userId = 'event_daily_failure';
  await seedReadyUser(db, userId);
  await installRelicFailureTrigger(db);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const daily = await claimDaily(client, userId);
    assert.equal(daily.status, 'ok');
    await assert.rejects(
      claimEventAttendance(client, userId, { config: CONFIG, now: NOW }),
      /injected relic update failure/
    );
    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await removeRelicFailureTrigger(db);
  }

  const final = await db.query(
    `SELECT u.monthly_streak, u.overall_streak, u.last_daily_claim_date,
            b.credux, b.belief_shards, b.silver_chest, b.sacred_relics
       FROM users u JOIN users_bag b ON b.discord_id = u.discord_id
      WHERE u.discord_id = $1`,
    [userId]
  );
  assert.deepEqual(final.rows[0], {
    monthly_streak: 0,
    overall_streak: 0,
    last_daily_claim_date: null,
    credux: 0,
    belief_shards: 0,
    silver_chest: 0,
    sacred_relics: 0,
  });
  const guard = await db.query(
    'SELECT count(*)::int AS count FROM event_attendance WHERE user_id = $1',
    [userId]
  );
  assert.equal(guard.rows[0].count, 0);
}

async function testCascadeAndAuditRetention(db) {
  const userId = 'event_cascade';
  await seedReadyUser(db, userId);
  await db.query(
    `INSERT INTO event_attendance (event_key, user_id, event_day) VALUES ($1, $2, 1);
     INSERT INTO event_quest_claims (event_key, user_id, event_day) VALUES ($1, $2, 1);
     INSERT INTO game_logs (discord_id, action, item_type) VALUES ($2, 'MonthsaryAuditTest', 'sacred_relics')`,
    [EVENT_KEY, userId]
  );
  await db.query('DELETE FROM users WHERE discord_id = $1', [userId]);
  const rows = await db.query(
    `SELECT
       (SELECT count(*)::int FROM event_attendance WHERE user_id = $1) AS attendance,
       (SELECT count(*)::int FROM event_quest_claims WHERE user_id = $1) AS quest,
       (SELECT count(*)::int FROM game_logs WHERE discord_id = $1) AS logs`,
    [userId]
  );
  assert.deepEqual(rows.rows[0], { attendance: 0, quest: 0, logs: 1 });
}

async function main() {
  const db = new Pool({
    connectionString: testDatabaseUrl(),
    ssl: false,
    max: 6,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
  });
  try {
    await createBaseSchema(db);
    await testMigration(db);
    await testFirstDailyClaim(db);
    await testCrossPathConcurrency(db);
    await testQuestFailureContainment(db);
    await testAttendanceFailureRollsBackDaily(db);
    await testCascadeAndAuditRetention(db);
    console.log('monthsary event database selftest passed');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
