'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const raidCommandSource = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'rpg', 'raid.js'), 'utf8');
const dailyLimitsSource = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'economy', 'dailyLimits.js'), 'utf8');
const raidLimitsSource = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'raidRewardLimits.js'), 'utf8');
const commandHandlerSource = fs.readFileSync(path.join(ROOT, 'src', 'handlers', 'commandHandler.js'), 'utf8');
const {
  resolveBattle,
  selectOverchargeDebuff,
} = require(path.join(ROOT, 'src', 'engine', 'battleEngine'));
const {
  RAID_REWARD_LIMITS,
  capRaidRewards,
  capRaidChest,
  formatRaidLimitStatus,
  raidLimitNotices,
} = require(path.join(ROOT, 'src', 'utils', 'raidRewardLimits'));
const { RAID_LOOT, rollRaidChest } = require(path.join(ROOT, 'src', 'config', 'raidLoot'));
const {
  grantDailyCompletionBonus,
  progressWeekly,
  describeWeekly,
} = require(path.join(ROOT, 'src', 'utils', 'questProgress'));
const { emoji } = require(path.join(ROOT, 'src', 'utils', 'emojis'));

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

function scripted(values, fallback = 0.5) {
  let index = 0;
  return () => (index < values.length ? values[index++] : fallback);
}

function player(over = {}) {
  return {
    name: 'Mage', kind: 'player', class: 'Mage', classPassive: 'overcharge',
    atk: 1000, hp: 100000, def: 0, crit: 0,
    weaponPassiveKey: 'none', armorPassiveKey: 'none', deityBlessingKey: 'none',
    ...over,
  };
}

function mob(over = {}) {
  return {
    name: 'Dummy', kind: 'mob', mobType: 'regular',
    atk: 0, hp: 1_000_000, def: 0, crit: 0,
    skillKey: 'none', immunityTags: [], specialFlags: {},
    ...over,
  };
}

function mageBattle(effectRoll, mobOver = {}) {
  // Boss mode fixes player-first order. Each round consumes player crit,
  // player variance, mob crit, mob variance; round 3 also consumes the one
  // Overcharge selection roll immediately after the primary hit.
  const rng = scripted([
    0.99, 0.5, 0.99, 0.5,
    0.99, 0.5, 0.99, 0.5,
    0.99, 0.5, effectRoll, 0.99, 0.5,
  ]);
  return resolveBattle(player(), mob(mobOver), { mode: 'boss', rng });
}

function eventsOf(sim, round) {
  return sim.rounds.find((entry) => entry.round === round)?.events || [];
}

function damageOf(events, fragment) {
  const line = events.find((event) => event.includes(fragment));
  return Number(/\*\*(\d+) DMG\*\*/.exec(line || '')?.[1] || 0);
}

async function main() {
// Overcharge's full range is one draw with four contiguous, non-overlapping bins.
check('Overcharge 0.00 selects Paralyze', selectOverchargeDebuff(0).tag === 'paralyze');
check('Overcharge 0.249999 selects Paralyze', selectOverchargeDebuff(0.249999).tag === 'paralyze');
check('Overcharge 0.25 selects Burn', selectOverchargeDebuff(0.25).tag === 'burn');
check('Overcharge 0.499999 selects Burn', selectOverchargeDebuff(0.499999).tag === 'burn');
check('Overcharge 0.50 selects DEF Down', selectOverchargeDebuff(0.50).tag === 'def_down');
check('Overcharge 0.749999 selects DEF Down', selectOverchargeDebuff(0.749999).tag === 'def_down');
check('Overcharge 0.75 selects ATK Down', selectOverchargeDebuff(0.75).tag === 'atk_down');
check('Overcharge 0.999999 selects ATK Down', selectOverchargeDebuff(0.999999).tag === 'atk_down');

const overchargeCases = [
  [0.10, 'Paralyze', '⚡ Overcharge: Paralyze applied!'],
  [0.30, 'Burn', '🔥 Overcharge: Burn applied for 1 turn.'],
  [0.60, 'DEF Down', '🛡️ Overcharge: Opponent DEF reduced by 25% for 1 turn.'],
  [0.80, 'ATK Down', '⚔️ Overcharge: Opponent ATK reduced by 25% for 1 turn.'],
];
for (const [roll, label, application] of overchargeCases) {
  const sim = mageBattle(roll);
  const r3 = eventsOf(sim, 3);
  check(`Overcharge applies exactly one ${label} effect`, r3.filter((event) => event.includes('Overcharge:')).length === 1);
  check(`Overcharge ${label} application is logged after its hit`, r3.indexOf(application) > r3.findIndex((event) => event.includes('Mage attacks for **')));
  check(`Overcharge ${label} retains normal primary resolution`, r3.some((event) => event.includes('Mage attacks for **2750 DMG** *(Overcharge!)*')));
}

{
  const sim = mageBattle(0.10, { hp: 1_000_000, atk: 100 });
  const r4 = eventsOf(sim, 4);
  check('Paralyze deals 5% of Mage effective ATK once', r4.filter((event) => event.includes('Paralyzed: Dummy takes 50 damage')).length === 1);
  check('Paralyze skips the target action without a normal strike', r4.some((event) => event.includes('Dummy is unable to act (paralyze)')) && !r4.some((event) => event.includes('Dummy strikes')));
  check('Paralyze target acts normally after its one skipped turn', eventsOf(sim, 5).some((event) => event.includes('Dummy strikes')));
}

{
  const sim = mageBattle(0.30);
  const burns = sim.rounds.flatMap((round) => round.events).filter((event) => event.includes('🔥 Burn deals 100 damage.'));
  check('Overcharge Burn deals 10% of Mage effective ATK once', burns.length === 1);
}

{
  const baseline = mageBattle(0.60, { def: 200, immunityTags: ['all_debuffs'] });
  const reduced = mageBattle(0.60, { def: 200 });
  check('DEF Down does not modify the Overcharge hit that applied it', damageOf(eventsOf(reduced, 3), 'Mage attacks') === damageOf(eventsOf(baseline, 3), 'Mage attacks'));
  check('DEF Down affects the following eligible attack window', damageOf(eventsOf(reduced, 4), 'Mage attacks') > damageOf(eventsOf(baseline, 4), 'Mage attacks'));
  check('DEF Down is absent after its duration expires', !eventsOf(reduced, 5).some((event) => event.includes('DEF reduced')));
}

{
  const baseline = mageBattle(0.80, { atk: 1000, immunityTags: ['all_debuffs'] });
  const reduced = mageBattle(0.80, { atk: 1000 });
  check('ATK Down reduces the next eligible damaging action by 25%', damageOf(eventsOf(reduced, 3), 'Dummy strikes') < damageOf(eventsOf(baseline, 3), 'Dummy strikes'));
  check('ATK Down expires instead of permanently changing mob ATK', damageOf(eventsOf(reduced, 5), 'Dummy strikes') === damageOf(eventsOf(baseline, 5), 'Dummy strikes'));
}

{
  const knight = {
    name: 'Knight', kind: 'player', class: 'Knight', classPassive: 'damage_reduction',
    atk: 0, hp: 10000, def: 0, crit: 0,
  };
  const inputHp = knight.hp;
  const sim = resolveBattle(knight, mob({ atk: 2000 }), { mode: 'boss', rng: () => 0.5 });
  check('Knight heals 1.5% of maximum HP and logs actual restoration', eventsOf(sim, 2).some((event) => event.includes('Knight Passive: Restored 1.5% max HP (+150 HP).')));
  check('Knight combat healing does not mutate stored input HP', knight.hp === inputHp);

  const defeated = resolveBattle(knight, mob({ atk: 100000 }), { mode: 'boss', rng: () => 0.5 });
  check('Defeated Knight receives no later passive healing', !defeated.rounds.flatMap((round) => round.events).some((event) => event.includes('Knight Passive: Restored')));
}

{
  const swordsman = {
    name: 'Swordsman', kind: 'player', class: 'Swordsman', classPassive: 'bleed',
    atk: 100, hp: 100000, def: 0, crit: 0,
  };
  const sim = resolveBattle(swordsman, mob({ hp: 1_000_000 }), { mode: 'boss', rng: () => 0.5 });
  const stackEvents = sim.rounds.flatMap((round) => round.events).filter((event) => event.includes('Swordsman Passive: ATK increased'));
  check('Swordsman stack progression is 5/10/15/20/25/30%', stackEvents.map((event) => Number(/Current bonus: (\d+)%/.exec(event)?.[1])).slice(0, 6).join(',') === '5,10,15,20,25,30');
  check('Swordsman stack never exceeds 30%', stackEvents.every((event) => Number(/Current bonus: (\d+)%/.exec(event)?.[1]) <= 30));
  check('Swordsman stack does not mutate stored input ATK', swordsman.atk === 100);
}

{
  const partial = capRaidRewards({
    current: { silverChests: 19, goldChests: 4, beliefShards: 9500 },
    requested: { silverChests: 3, goldChests: 2, beliefShards: 1000 },
    regularRaid: true,
    eliteMobRaid: true,
  });
  check('Raid caps grant partial Silver, Gold, and Shards independently', partial.granted.silverChests === 1 && partial.granted.goldChests === 1 && partial.granted.beliefShards === 500);
  check('Raid cap totals stop exactly at 20/5/10000', partial.totals.silverChests === 20 && partial.totals.goldChests === 5 && partial.totals.beliefShards === 10000);
  check('Capped Silver, Gold, and Shard portions emit no battle notices', raidLimitNotices(partial).length === 0);
  const blockedGoldChest = capRaidChest({
    current: { goldChests: 5 },
    chestCol: 'gold_chest',
    mobType: 'elite',
  });
  check('Elite raid does not grant Gold Chest at 5/5', blockedGoldChest.chestCol === null && blockedGoldChest.granted.goldChests === 0 && blockedGoldChest.blocked.goldChests === 1);
  check('Blocked Gold Chest emits no daily-limit notice', blockedGoldChest.notices.length === 0);
  check('Raid tracking line always shows shards and Silver Chest totals', formatRaidLimitStatus(partial.totals).includes('Belief Shards: 10,000/10,000') && formatRaidLimitStatus(partial.totals).includes('Silver Chest: 20/20'));
  check('Raid tracking line includes the reward icons', formatRaidLimitStatus(partial.totals).includes('<:belief_shards:') && formatRaidLimitStatus(partial.totals).includes('<:silver_chest:'));
  check('Raid tracking line always shows the Gold Chest total', formatRaidLimitStatus(partial.totals).includes('Gold Chest: 5/5'));
  check('Raid tracking line includes the Gold Chest icon', formatRaidLimitStatus(partial.totals).includes('<:gold_chest:'));
  check('Raid enforces chest limits from the shared daily log totals',
    raidCommandSource.includes('getRaidRewardTotals')
      && raidCommandSource.includes('capRaidRewards')
      && raidCommandSource.includes('chestCol = allocation.granted.silverChests'));
  check('Raid enforces Belief Shard limits even without a chest roll',
    raidCommandSource.includes('if (won && (chestCol || shards > 0))')
      && raidCommandSource.includes('beliefShards: shards')
      && raidCommandSource.includes('shards = allocation.granted.beliefShards'));
  check('Daily limits are read only when the new command is used',
    commandHandlerSource.includes('dailyLimitsCmd.execute(message)')
      && dailyLimitsSource.includes('getRaidRewardTotals')
      && raidLimitsSource.includes('FROM raid_logs')
      && raidLimitsSource.includes('AT TIME ZONE \'Asia/Manila\''));
  check('Daily limits use the existing reward icons and all three counters',
    dailyLimitsSource.includes('formatRaidLimitStatus')
      && raidLimitsSource.includes('silver_chests')
      && raidLimitsSource.includes('gold_chests')
      && raidLimitsSource.includes('belief_shards'));
  check('Stale raid takeover receives a fresh idempotency key',
    raidCommandSource.includes("battle_id = nextval(pg_get_serial_sequence('active_battles', 'battle_id'))"));
  const unrelated = capRaidRewards({ current: {}, requested: { silverChests: 3, goldChests: 2, beliefShards: 100 }, regularRaid: false, eliteMobRaid: false });
  check('Non-raid chest sources do not consume raid chest caps', unrelated.granted.silverChests === 0 && unrelated.granted.goldChests === 0 && unrelated.granted.beliefShards === 100);
  const blocked = capRaidRewards({ current: { beliefShards: 10000 }, requested: { beliefShards: 1 } });
  check('Fully capped rewards grant zero, never negative, and remain silent', blocked.granted.beliefShards === 0 && blocked.blocked.beliefShards === 1 && raidLimitNotices(blocked).length === 0);
  check('Runtime raid caps remain exactly 20 Silver, 5 Gold, and 10,000 Shards',
    RAID_REWARD_LIMITS.silverChests === 20
      && RAID_REWARD_LIMITS.goldChests === 5
      && RAID_REWARD_LIMITS.beliefShards === 10000);
  check('Raid chest drop chances are exactly 20% Silver and 50% Gold',
    RAID_LOOT.regular.win.chestChance === 0.20
      && RAID_LOOT.elite.win.chestChance === 0.50
      && rollRaidChest(RAID_LOOT.regular.win, () => 0.199999) === 'silver_chest'
      && rollRaidChest(RAID_LOOT.regular.win, () => 0.20) === null
      && rollRaidChest(RAID_LOOT.elite.win, () => 0.499999) === 'gold_chest'
      && rollRaidChest(RAID_LOOT.elite.win, () => 0.50) === null);
}

{
  let guardAvailable = true;
  const dailyQueries = [];
  const dailyClient = {
    async query(sql) {
      dailyQueries.push(sql);
      if (sql.includes('SELECT count(*)')) return { rows: [{ total: 3, done: 3 }] };
      if (sql.includes('INSERT INTO daily_quest_completion_rewards')) {
        if (!guardAvailable) return { rows: [] };
        guardAvailable = false;
        return { rows: [{ discord_id: 'u' }] };
      }
      if (sql.includes('UPDATE users_bag')) return { rows: [{ sacred_relics: 7 }] };
      return { rows: [] };
    },
  };
  check('Daily full-set bonus grants the exact player-facing notice', await grantDailyCompletionBonus(dailyClient, 'u') === `Daily Quest Completion Bonus: +1 ${emoji('sacred_relic')} Sacred Relic`);
  check('Daily full-set bonus guard is idempotent', await grantDailyCompletionBonus(dailyClient, 'u') === null);
  check('Daily full-set guard and credit use one transaction path', dailyQueries.some((sql) => sql.includes('INSERT INTO daily_quest_completion_rewards')));
}

{
  const weeklyQueries = [];
  const weeklyClient = {
    async query(sql) {
      weeklyQueries.push(sql);
      if (sql.includes('SELECT pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('SELECT 1 FROM weekly_quests')) return { rows: [{ '?column?': 1 }] };
      if (sql.startsWith('UPDATE weekly_quests') && sql.includes('current_count')) {
        return { rows: [{ id: 1, target_count: 1, current_count: 1, reward_credux: 20000, reward_valor: 40 }] };
      }
      if (sql.includes('UPDATE weekly_quests SET completed')) return { rows: [{ id: 1 }] };
      if (sql.includes('UPDATE users_bag')) return { rows: [{ credux: 20000, sacred_relics: 1 }] };
      return { rows: [] };
    },
  };
  const notices = await progressWeekly(weeklyClient, 'u', { raid_wins: 1 });
  check('Each weekly quest completion reports +1 Sacred Relic', notices.length === 1 && notices[0].includes('+1 Sacred Relic'));
  check('Weekly quest reward path credits Sacred Relic separately', weeklyQueries.some((sql) => sql.includes('sacred_relics = sacred_relics + $4')));
  check('Weekly render data includes one relic per quest', describeWeekly({ quest_type: 'raid_wins', target_count: 1, current_count: 0, reward_credux: 20000, reward_valor: 40, completed: false }).rewardRelics === 1);
}

{
  const migration = fs.readFileSync(path.join(ROOT, 'scripts', 'migrations', '20260807_01_combat_raid_quest_rewards.sql'), 'utf8');
  const raidLimits = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'raidRewardLimits.js'), 'utf8');
  const questSource = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'questProgress.js'), 'utf8');
  check('Raid migration constrains all three daily counters', migration.includes('silver_chests <= 20') && migration.includes('gold_chests <= 10') && migration.includes('belief_shards <= 10000'));
  check('Raid allocation locks the date-keyed row', raidLimits.includes('FOR UPDATE') && raidLimits.includes('ON CONFLICT (discord_id, reward_date) DO NOTHING'));
  check('Raid reward retry has a persisted idempotency table', migration.includes('CREATE TABLE IF NOT EXISTS public.raid_reward_grants'));
  check('Summon delivery replay has a persisted idempotency table',
    migration.includes('CREATE TABLE IF NOT EXISTS public.summon_reward_grants'));
  const grandBlock = questSource.slice(questSource.indexOf('async function claimWeeklyGrand'));
  check('Weekly full-completion handler no longer credits a Sacred Relic', grandBlock.includes('relics: 0') && !grandBlock.includes('sacred_relics'));
}

  console.log(`COMBAT / REWARD UPDATE SELFTEST: ${passed} passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
