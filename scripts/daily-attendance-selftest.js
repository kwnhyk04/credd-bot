'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  claimDaily,
  dailyReward,
} = require('../src/commands/economy/daily');

const DAY_MS = 24 * 60 * 60 * 1000;
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

function phtDateKey(instant) {
  return new Date(new Date(instant).getTime() + PHT_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDate(dateKey, days) {
  const instant = new Date(`${dateKey}T00:00:00.000Z`);
  return new Date(instant.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

class FakeAttendanceClient {
  constructor({
    now = '2026-08-01T04:00:00.000Z',
    monthly = 0,
    overall = 0,
    lastDate = null,
    bag = {},
  } = {}) {
    this.now = now;
    this.user = {
      monthly_streak: monthly,
      overall_streak: overall,
      last_daily_claim_date: lastDate,
    };
    this.bag = {
      credux: 0,
      belief_shards: 0,
      lifetime_credux_earned: 0,
      silver_chest: 0,
      gold_chest: 0,
      boss_treasure_chest: 0,
      boss_golden_chest: 0,
      ...bag,
    };
    this.queries = [];
    this.logs = [];
  }

  setNow(now) {
    this.now = now;
  }

  async query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    this.queries.push({ sql: normalized, params: [...params] });

    if (normalized.startsWith('SELECT 1 FROM users_bag')) {
      return { rows: [{ '?column?': 1 }] };
    }

    if (normalized.startsWith('SELECT monthly_streak')) {
      const today = phtDateKey(this.now);
      return {
        rows: [{
          monthly_streak: this.user.monthly_streak,
          overall_streak: this.user.overall_streak,
          claimed_today: this.user.last_daily_claim_date === today,
          claimed_yesterday: this.user.last_daily_claim_date === shiftDate(today, -1),
        }],
      };
    }

    if (normalized.startsWith('UPDATE users_bag')) {
      const credux = Number(params[1]);
      const shards = Number(params[2]);
      const baseCol = normalized.includes('silver_chest = silver_chest + 1')
        ? 'silver_chest'
        : 'gold_chest';
      const milestoneCol = normalized.includes('boss_treasure_chest = boss_treasure_chest + 1')
        ? 'boss_treasure_chest'
        : normalized.includes('boss_golden_chest = boss_golden_chest + 1')
          ? 'boss_golden_chest'
          : null;

      this.bag.credux += credux;
      this.bag.belief_shards += shards;
      this.bag.lifetime_credux_earned += credux;
      this.bag[baseCol] += 1;
      if (milestoneCol) this.bag[milestoneCol] += 1;

      return {
        rows: [{
          credux: this.bag.credux,
          belief_shards: this.bag.belief_shards,
          chest_count: this.bag[baseCol],
          ...(milestoneCol ? { milestone_chest_count: this.bag[milestoneCol] } : {}),
        }],
      };
    }

    if (normalized.startsWith('UPDATE users SET')) {
      this.user.monthly_streak = Number(params[1]);
      this.user.overall_streak = Number(params[2]);
      this.user.last_daily_claim_date = phtDateKey(this.now);
      return { rows: [] };
    }

    if (normalized.startsWith('INSERT INTO game_logs')) {
      this.logs.push({ sql: normalized, params: [...params] });
      return { rows: [] };
    }

    throw new Error(`Unexpected attendance query: ${normalized}`);
  }
}

function testBaseRewards() {
  const brackets = [
    { from: 1, to: 6, credux: 50000, shards: 100, chestCol: 'silver_chest', chestLabel: 'Silver Chest' },
    { from: 7, to: 7, credux: 250000, shards: 250, chestCol: 'gold_chest', chestLabel: 'Gold Chest' },
    { from: 8, to: 13, credux: 75000, shards: 150, chestCol: 'silver_chest', chestLabel: 'Silver Chest' },
    { from: 14, to: 14, credux: 400000, shards: 350, chestCol: 'gold_chest', chestLabel: 'Gold Chest' },
    { from: 15, to: 20, credux: 100000, shards: 200, chestCol: 'silver_chest', chestLabel: 'Silver Chest' },
    { from: 21, to: 21, credux: 600000, shards: 500, chestCol: 'gold_chest', chestLabel: 'Gold Chest' },
    { from: 22, to: 27, credux: 150000, shards: 250, chestCol: 'silver_chest', chestLabel: 'Silver Chest' },
    { from: 28, to: 28, credux: 750000, shards: 600, chestCol: 'gold_chest', chestLabel: 'Gold Chest' },
    { from: 29, to: 29, credux: 1000000, shards: 750, chestCol: 'gold_chest', chestLabel: 'Gold Chest' },
    { from: 30, to: 30, credux: 1500000, shards: 1000, chestCol: 'gold_chest', chestLabel: 'Gold Chest' },
  ];

  for (const bracket of brackets) {
    for (let day = bracket.from; day <= bracket.to; day += 1) {
      assert.deepEqual(dailyReward(day), {
        credux: bracket.credux,
        shards: bracket.shards,
        chestCol: bracket.chestCol,
        chestLabel: bracket.chestLabel,
      });
    }
  }
}

async function testMilestoneTable() {
  const expected = new Map([
    [15, 'Boss Treasure Chest'],
    [30, 'Boss Golden Chest'],
    [45, 'Boss Golden Chest'],
    [60, 'Boss Golden Chest'],
    [75, 'Boss Golden Chest'],
    [90, 'Boss Golden Chest'],
    [105, 'Boss Golden Chest'],
  ]);
  for (const streak of [1, 14, 15, 16, 29, 30, 31, 44, 45, 60, 75, 90, 105]) {
    const { result } = await claimFromState({ monthly: 1, overall: streak - 1 });
    assert.equal(result.overall, streak);
    assert.equal(result.milestoneChestLabel, expected.get(streak) || null);
  }
}

async function claimFromState({ monthly, overall }) {
  const today = '2026-08-20T04:00:00.000Z';
  const client = new FakeAttendanceClient({
    now: today,
    monthly,
    overall,
    lastDate: shiftDate(phtDateKey(today), -1),
  });
  return { client, result: await claimDaily(client, 'milestone_user') };
}

async function testNewStreakValueDeterminesMilestone() {
  const day15 = await claimFromState({ monthly: 14, overall: 14 });
  assert.equal(day15.result.monthly, 15);
  assert.equal(day15.result.overall, 15);
  assert.equal(day15.result.milestoneChestLabel, 'Boss Treasure Chest');
  assert.equal(day15.client.bag.silver_chest, 1);
  assert.equal(day15.client.bag.boss_treasure_chest, 1);

  const day30 = await claimFromState({ monthly: 29, overall: 29 });
  assert.equal(day30.result.monthly, 30);
  assert.equal(day30.result.overall, 30);
  assert.equal(day30.result.milestoneChestLabel, 'Boss Golden Chest');
  assert.equal(day30.client.bag.gold_chest, 1);
  assert.equal(day30.client.bag.boss_golden_chest, 1);

  const day45 = await claimFromState({ monthly: 14, overall: 44 });
  assert.equal(day45.result.monthly, 15);
  assert.equal(day45.result.overall, 45);
  assert.equal(day45.result.credux, 100000);
  assert.equal(day45.result.shards, 200);
  assert.equal(day45.result.chestLabel, 'Silver Chest');
  assert.equal(day45.result.milestoneChestLabel, 'Boss Golden Chest');
  assert.equal(day45.client.bag.boss_treasure_chest, 0);
  assert.equal(day45.client.bag.boss_golden_chest, 1);
}

async function testFortyFiveClaimsAndDuplicateGuard() {
  const client = new FakeAttendanceClient();
  const start = Date.parse('2026-01-01T04:00:00.000Z');
  let final;

  for (let claim = 1; claim <= 45; claim += 1) {
    client.setNow(new Date(start + (claim - 1) * DAY_MS).toISOString());
    final = await claimDaily(client, 'forty_five_user');
    assert.equal(final.status, 'ok');
    assert.equal(final.monthly, ((claim - 1) % 30) + 1);
    assert.equal(final.overall, claim);
    const expectedMilestone = claim === 15
      ? 'Boss Treasure Chest'
      : claim >= 30 && claim % 15 === 0
        ? 'Boss Golden Chest'
        : null;
    assert.equal(final.milestoneChestLabel, expectedMilestone);
  }

  assert.equal(final.monthly, 15);
  assert.equal(final.overall, 45);
  assert.equal(final.chestLabel, 'Silver Chest');
  assert.equal(final.milestoneChestLabel, 'Boss Golden Chest');
  assert.deepEqual(client.bag, {
    credux: 8250000,
    belief_shards: 9950,
    lifetime_credux_earned: 8250000,
    silver_chest: 37,
    gold_chest: 8,
    boss_treasure_chest: 1,
    boss_golden_chest: 2,
  });

  const bossLogs = client.logs.filter((entry) =>
    ['boss_treasure_chest', 'boss_golden_chest'].includes(entry.params[1]));
  assert.deepEqual(bossLogs.map((entry) => entry.params[1]), [
    'boss_treasure_chest',
    'boss_golden_chest',
    'boss_golden_chest',
  ]);

  const beforeDuplicate = JSON.stringify({ user: client.user, bag: client.bag, logs: client.logs });
  const duplicate = await claimDaily(client, 'forty_five_user');
  assert.deepEqual(duplicate, { status: 'already', monthly: 15, overall: 45 });
  assert.equal(JSON.stringify({ user: client.user, bag: client.bag, logs: client.logs }), beforeDuplicate);
}

async function testBrokenStreakAndReearnedMilestones() {
  const client = new FakeAttendanceClient({
    monthly: 1,
    overall: 31,
    lastDate: '2026-04-01',
    now: '2026-04-03T04:00:00.000Z',
  });

  const reset = await claimDaily(client, 'reset_user');
  assert.equal(reset.monthly, 1);
  assert.equal(reset.overall, 1);
  assert.equal(reset.milestoneChestLabel, null);

  const start = Date.parse('2026-04-03T04:00:00.000Z');
  const milestones = [];
  for (let streak = 2; streak <= 30; streak += 1) {
    client.setNow(new Date(start + (streak - 1) * DAY_MS).toISOString());
    const result = await claimDaily(client, 'reset_user');
    if (result.milestoneChestLabel) {
      milestones.push([result.overall, result.milestoneChestLabel]);
    }
  }
  assert.deepEqual(milestones, [
    [15, 'Boss Treasure Chest'],
    [30, 'Boss Golden Chest'],
  ]);
  assert.equal(client.bag.boss_treasure_chest, 1);
  assert.equal(client.bag.boss_golden_chest, 1);
}

async function testPhtBoundaryAndRestartPersistence() {
  const beforeMidnight = '2026-08-10T15:50:00.000Z'; // 11:50 PM PHT
  const afterMidnight = '2026-08-10T16:10:00.000Z';  // 12:10 AM PHT
  assert.equal(phtDateKey(beforeMidnight), '2026-08-10');
  assert.equal(phtDateKey(afterMidnight), '2026-08-11');

  const firstProcess = new FakeAttendanceClient({ now: beforeMidnight });
  const first = await claimDaily(firstProcess, 'restart_user');
  assert.equal(first.overall, 1);
  const dateQuery = firstProcess.queries.find((entry) => entry.sql.startsWith('SELECT monthly_streak'));
  assert.match(dateQuery.sql, /NOW\(\) AT TIME ZONE 'Asia\/Manila'/);
  assert.match(dateQuery.sql, /INTERVAL '1 day'/);

  const restartedProcess = new FakeAttendanceClient({
    now: afterMidnight,
    monthly: firstProcess.user.monthly_streak,
    overall: firstProcess.user.overall_streak,
    lastDate: firstProcess.user.last_daily_claim_date,
    bag: firstProcess.bag,
  });
  const second = await claimDaily(restartedProcess, 'restart_user');
  assert.equal(second.status, 'ok');
  assert.equal(second.monthly, 2);
  assert.equal(second.overall, 2);
}

function testDisplayAndScope() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'commands', 'economy', 'daily.js'),
    'utf8'
  );
  assert.match(source, /Month: \$\{result\.monthly\} \/ 30 · Streak: \$\{result\.overall\} days/);
  assert.doesNotMatch(source, /· Overall:/);
  assert.doesNotMatch(source, /raidRewardLimits/);
}

async function main() {
  testBaseRewards();
  await testMilestoneTable();
  await testNewStreakValueDeterminesMilestone();
  await testFortyFiveClaimsAndDuplicateGuard();
  await testBrokenStreakAndReearnedMilestones();
  await testPhtBoundaryAndRestartPersistence();
  testDisplayAndScope();
  console.log('Daily attendance self-test passed (rewards, milestones, PHT reset, duplicate guard, 45-day cycle).');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
