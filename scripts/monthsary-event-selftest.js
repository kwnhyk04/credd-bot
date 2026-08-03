'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  EVENT_START_AT,
  EVENT_ENABLED,
  MONTHSARY_EVENT,
  buildEventConfig,
  eventStateAt,
  attendanceRewardForDay,
} = require('../src/config/monthsaryEvent');
const {
  claimEventAttendance,
  claimEventQuestDay,
} = require('../src/engine/monthsaryEvent');

const START = '2026-08-10T00:00:00+08:00';
const CONFIG = buildEventConfig({ enabled: true, startAt: START });
const DAY_MS = 86_400_000;
const startMs = Date.parse(START);

function result(rows = []) {
  return { rows, rowCount: rows.length };
}

function cloneState(state) {
  return {
    sacredRelics: state.sacredRelics,
    bossTreasureChests: state.bossTreasureChests,
    bossGoldenChests: state.bossGoldenChests,
    credux: state.credux,
    shards: state.shards,
    attendance: new Set(state.attendance),
    quests: new Set(state.quests),
    logs: state.logs.slice(),
  };
}

function restoreState(target, snapshot) {
  Object.assign(target, cloneState(snapshot));
}

function fakeClient(state, {
  now = new Date(startMs + 12 * 3_600_000),
  completed = 3,
  failQuestBagUpdate = false,
  failAttendanceBagUpdate = false,
} = {}) {
  let savepoint = null;
  return {
    calls: [],
    async query(rawSql, params = []) {
      const sql = String(rawSql).replace(/\s+/g, ' ').trim();
      this.calls.push({ sql, params });

      if (sql === 'BEGIN') return result();
      if (sql === 'COMMIT') return result();
      if (sql === 'ROLLBACK') return result();
      if (sql === 'SAVEPOINT monthsary_quest_claim') {
        savepoint = cloneState(state);
        return result();
      }
      if (sql === 'ROLLBACK TO SAVEPOINT monthsary_quest_claim') {
        if (!savepoint) throw new Error('savepoint missing');
        restoreState(state, savepoint);
        return result();
      }
      if (sql === 'RELEASE SAVEPOINT monthsary_quest_claim') {
        savepoint = null;
        return result();
      }
      if (sql === 'SELECT NOW() AS event_now') return result([{ event_now: now }]);
      if (sql.includes('FROM daily_quests')) return result([{ total: 3, completed }]);

      if (sql.startsWith('INSERT INTO event_attendance')) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        if (state.attendance.has(key)) return result();
        state.attendance.add(key);
        return result([{ event_day: params[2] }]);
      }
      if (sql.startsWith('INSERT INTO event_quest_claims')) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        if (state.quests.has(key)) return result();
        state.quests.add(key);
        return result([{ event_day: params[2] }]);
      }
      if (sql.startsWith('UPDATE users_bag') && sql.includes('boss_treasure_chest')) {
        if (failAttendanceBagUpdate) throw new Error('injected attendance update failure');
        state.sacredRelics += Number(params[1]);
        state.bossTreasureChests += Number(params[2]);
        state.bossGoldenChests += Number(params[3]);
        return result([{
          sacred_relics: state.sacredRelics,
          boss_treasure_chest: state.bossTreasureChests,
          boss_golden_chest: state.bossGoldenChests,
        }]);
      }
      if (sql.startsWith('UPDATE users_bag') && sql.includes('sacred_relics')) {
        if (failQuestBagUpdate) throw new Error('injected quest update failure');
        state.sacredRelics += Number(params[1]);
        return result([{ sacred_relics: state.sacredRelics }]);
      }
      if (sql.startsWith('INSERT INTO game_logs')) {
        state.logs.push(params.slice());
        return result();
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };
}

function initialState() {
  return {
    sacredRelics: 0,
    bossTreasureChests: 0,
    bossGoldenChests: 0,
    credux: 0,
    shards: 0,
    attendance: new Set(),
    quests: new Set(),
    logs: [],
  };
}

class Mutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  async run(fn) {
    let unlock;
    const gate = new Promise((resolve) => { unlock = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => gate);
    await previous;
    try { return await fn(); } finally { unlock(); }
  }
}

async function withTimeout(promise, ms = 2_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('concurrency test timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function testConfigBoundaries() {
  assert.equal(EVENT_ENABLED, true);
  assert.equal(EVENT_START_AT, '2026-08-05T00:00:00+08:00');
  assert.equal(MONTHSARY_EVENT.enabled, true);
  assert.equal(MONTHSARY_EVENT.valid, true);
  assert.equal(CONFIG.valid, true);
  assert.equal(CONFIG.endAt.getTime() - CONFIG.startAt.getTime(), 7 * DAY_MS);
  assert.deepEqual(eventStateAt(new Date(startMs - 1), CONFIG), {
    active: false, reason: 'before_start', eventDay: null,
  });
  assert.equal(eventStateAt(new Date(startMs), CONFIG).eventDay, 1);
  assert.equal(eventStateAt(new Date(startMs + DAY_MS), CONFIG).eventDay, 2);
  assert.equal(eventStateAt(new Date(startMs + 6 * DAY_MS), CONFIG).eventDay, 7);
  assert.equal(eventStateAt(new Date(startMs + 7 * DAY_MS - 1), CONFIG).eventDay, 7);
  assert.deepEqual(eventStateAt(new Date(startMs + 7 * DAY_MS), CONFIG), {
    active: false, reason: 'ended', eventDay: null,
  });
  assert.equal(buildEventConfig({ enabled: true, startAt: '' }).valid, false);
  assert.equal(buildEventConfig({ enabled: true, startAt: '2026-08-10T01:00:00+08:00' }).valid, false);
  assert.equal(buildEventConfig({ enabled: true, startAt: '2026-02-30T00:00:00+08:00' }).valid, false);
  assert.equal(attendanceRewardForDay(6, CONFIG).bossGoldenChests, 0);
  assert.equal(attendanceRewardForDay(7, CONFIG).bossGoldenChests, 1);
}

async function testKillSwitchIsAQueryFreeNoop() {
  const config = buildEventConfig({ enabled: false });
  const state = initialState();
  const client = fakeClient(state);
  const attendance = await claimEventAttendance(client, 'off', { config });
  const quest = await claimEventQuestDay(client, 'off', { config });
  assert.equal(attendance.status, 'inactive');
  assert.equal(quest.status, 'inactive');
  assert.equal(client.calls.length, 0);
}

async function testAttendanceAndDuplicateGuard() {
  const state = initialState();
  const client = fakeClient(state);
  const first = await claimEventAttendance(client, 'u1', { config: CONFIG });
  const second = await claimEventAttendance(client, 'u1', { config: CONFIG });
  assert.equal(first.status, 'ok');
  assert.equal(second.status, 'already');
  assert.equal(state.sacredRelics, 1);
  assert.equal(state.bossTreasureChests, 1);
  assert.equal(state.bossGoldenChests, 0);
  assert.equal(state.attendance.size, 1);
  assert.equal(state.logs.length, 2);
}

async function testDaySevenAttendance() {
  const state = initialState();
  const client = fakeClient(state, { now: new Date(startMs + 6 * DAY_MS + 1_000) });
  const claimed = await claimEventAttendance(client, 'u7', { config: CONFIG });
  assert.equal(claimed.eventDay, 7);
  assert.equal(state.sacredRelics, 1);
  assert.equal(state.bossTreasureChests, 1);
  assert.equal(state.bossGoldenChests, 1);
  assert.equal(state.logs.length, 3);
}

async function testSkippedAttendanceAndSevenDayCap() {
  const skipped = initialState();
  await claimEventAttendance(fakeClient(skipped), 'skip-user', { config: CONFIG });
  await claimEventAttendance(
    fakeClient(skipped, { now: new Date(startMs + 2 * DAY_MS + 1_000) }),
    'skip-user',
    { config: CONFIG }
  );
  assert.equal(skipped.attendance.size, 2);
  assert([...skipped.attendance].some((key) => key.endsWith(':1')));
  assert([...skipped.attendance].some((key) => key.endsWith(':3')));
  assert(![...skipped.attendance].some((key) => key.endsWith(':2')));

  const full = initialState();
  for (let day = 0; day < 7; day += 1) {
    const now = new Date(startMs + day * DAY_MS + 1_000);
    const client = fakeClient(full, { now });
    assert.equal((await claimEventAttendance(client, 'cap-user', { config: CONFIG })).status, 'ok');
    assert.equal((await claimEventQuestDay(client, 'cap-user', { config: CONFIG })).status, 'ok');
  }
  assert.equal(full.attendance.size, 7);
  assert.equal(full.quests.size, 7);
  assert.equal(full.sacredRelics, 14);
  assert.equal(full.bossTreasureChests, 7);
  assert.equal(full.bossGoldenChests, 1);
}

async function testConcurrentAttendanceGuard() {
  const state = initialState();
  const client = fakeClient(state);
  const claims = await Promise.all([
    claimEventAttendance(client, 'parallel-user', { config: CONFIG }),
    claimEventAttendance(client, 'parallel-user', { config: CONFIG }),
  ]);
  assert.deepEqual(claims.map((claim) => claim.status).sort(), ['already', 'ok']);
  assert.equal(state.attendance.size, 1);
  assert.equal(state.sacredRelics, 1);
  assert.equal(state.bossTreasureChests, 1);
}

async function testQuestPushAndDuplicateGuard() {
  const state = initialState();
  const incomplete = await claimEventQuestDay(fakeClient(state, { completed: 2 }), 'u2', { config: CONFIG });
  assert.equal(incomplete.status, 'incomplete');
  assert.equal(state.sacredRelics, 0);

  const client = fakeClient(state);
  const first = await claimEventQuestDay(client, 'u2', { config: CONFIG });
  const second = await claimEventQuestDay(client, 'u2', { config: CONFIG });
  assert.equal(first.status, 'ok');
  assert.equal(second.status, 'already');
  assert.equal(state.sacredRelics, 1);
  assert.equal(state.quests.size, 1);
  assert.equal(state.logs.length, 1);
}

async function testQuestFailureIsContained() {
  const state = initialState();
  state.credux = 3_000;
  state.shards = 5;
  const client = fakeClient(state, { failQuestBagUpdate: true });
  const claimed = await claimEventQuestDay(client, 'u3', { config: CONFIG });
  await client.query('COMMIT');

  assert.equal(claimed.status, 'error');
  assert.equal(state.credux, 3_000);
  assert.equal(state.shards, 5);
  assert.equal(state.sacredRelics, 0);
  assert.equal(state.quests.size, 0);
  assert.equal(state.logs.length, 0);
  assert(client.calls.some((call) => call.sql === 'ROLLBACK TO SAVEPOINT monthsary_quest_claim'));
  assert(client.calls.some((call) => call.sql === 'COMMIT'));
}

async function testAttendanceFailurePropagates() {
  const state = initialState();
  const before = cloneState(state);
  state.credux = 1_000;
  state.shards = 3;
  const client = fakeClient(state, { failAttendanceBagUpdate: true });
  await assert.rejects(
    claimEventAttendance(client, 'u4', { config: CONFIG }),
    /injected attendance update failure/
  );
  restoreState(state, before);
  assert.equal(state.credux, 0);
  assert.equal(state.shards, 0);
  assert.equal(state.attendance.size, 0);
}

async function testCrossPathConcurrency() {
  const state = initialState();
  const bagLock = new Mutex();
  const daily = bagLock.run(async () => {
    const client = fakeClient(state);
    return claimEventAttendance(client, 'same-user', { config: CONFIG });
  });
  const quest = bagLock.run(async () => {
    const client = fakeClient(state);
    return claimEventQuestDay(client, 'same-user', { config: CONFIG });
  });

  const [dailyResult, questResult] = await withTimeout(Promise.all([daily, quest]));
  assert.equal(dailyResult.status, 'ok');
  assert.equal(questResult.status, 'ok');
  assert.equal(state.attendance.size, 1);
  assert.equal(state.quests.size, 1);
  assert.equal(state.sacredRelics, 2);
}

function testMigrationAndHookShape() {
  const migration = fs.readFileSync(
    path.join(__dirname, 'migrations', '20260804_01_monthsary_event.sql'), 'utf8'
  );
  assert.equal((migration.match(/ON DELETE CASCADE/g) || []).length, 2);
  assert.equal((migration.match(/ENABLE ROW LEVEL SECURITY/g) || []).length, 2);
  assert(!migration.includes('DROP TABLE'));

  const daily = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'economy', 'daily.js'), 'utf8');
  const quest = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'questProgress.js'), 'utf8');
  const eventEngine = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'monthsaryEvent.js'), 'utf8');
  assert(daily.indexOf('claimEventAttendance(client, discordId)') < daily.indexOf("client.query('COMMIT')"));
  assert(quest.includes('claimEventQuestDay(client, discordId)'));
  assert(!daily.includes('Boss Golden Treasure Chest'));
  assert(!/(supporter|token|cosmetic|skin)/i.test(eventEngine));
}

async function main() {
  await testConfigBoundaries();
  await testKillSwitchIsAQueryFreeNoop();
  await testAttendanceAndDuplicateGuard();
  await testDaySevenAttendance();
  await testSkippedAttendanceAndSevenDayCap();
  await testConcurrentAttendanceGuard();
  await testQuestPushAndDuplicateGuard();
  await testQuestFailureIsContained();
  await testAttendanceFailurePropagates();
  await testCrossPathConcurrency();
  testMigrationAndHookShape();
  console.log('monthsary event selftest passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
