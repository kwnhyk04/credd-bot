'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const bosses = require(path.join(ROOT, 'src', 'config', 'bosses'));
const calamityRewards = require(path.join(ROOT, 'src', 'engine', 'calamityRewards'));
const rewardSource = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'calamityRewards.js'), 'utf8');
const bossSource = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'bossSystem.js'), 'utf8');
const duelSource = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'rpg', 'duel.js'), 'utf8');
const duelLocksSource = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'duelLocks.js'), 'utf8');
const devSource = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'rpg', 'dev.js'), 'utf8');
const bossCommandSource = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'rpg', 'boss.js'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) passed += 1;
  else {
    failed += 1;
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  }
}

function run(name, fn) {
  try {
    fn();
    check(name, true);
  } catch (err) {
    check(name, false, err.message);
  }
}

run('regular and developer Calamity spawns share one guaranteed golden chest', () => {
  assert.deepEqual(bosses.bossChestForSpawn('Fenrir', 'natural'), {
    column: 'boss_golden_chest', qty: 1, label: 'Boss Golden Chest',
  });
  assert.deepEqual(bosses.bossChestForSpawn('Fenrir', 'dev'), {
    column: 'boss_golden_chest', qty: 1, label: 'Boss Golden Chest',
  });
});

run('normal boss chest behavior remains unchanged', () => {
  assert.deepEqual(bosses.bossChestForSpawn('Medusa'), {
    column: 'boss_treasure_chest', qty: 1, label: 'Boss Treasure Chest',
  });
});

run('damage ratio is not rounded before threshold calculation', () => {
  const logs = [];
  const result = calamityRewards.rollCalamitySupremeRewards([
    { discord_id: 'a', total_damage: 3_000_000 },
    { discord_id: 'b', total_damage: 2_700_000 },
  ], { randomInteger: () => calamityRewards.ROLL_SCALE - 1, logger: (_message, detail) => logs.push(detail) });
  assert.equal(result.totalEligibleDamage, 5_700_000);
  assert.equal(result.rolls[0].rawDamageRatio, 3_000_000 / 5_700_000);
  assert.equal(result.rolls[0].calculatedThreshold, 526315);
  assert.equal(logs[0].supremeChestGranted, 0);
});

run('every eligible participant receives an independent roll', () => {
  const rolls = [];
  const result = calamityRewards.rollCalamitySupremeRewards([
    { discord_id: 'a', total_damage: 3 },
    { discord_id: 'b', total_damage: 2 },
    { discord_id: 'zero', total_damage: 0 },
    { discord_id: 'negative', total_damage: -1 },
  ], { randomInteger: (min, max) => { rolls.push([min, max]); return 0; }, logger: () => {} });
  assert.equal(rolls.length, 2);
  assert.deepEqual(result.winnerIds, ['a', 'b']);
  assert.equal(result.rolls.every((roll) => roll.supremeChestGranted === 1), true);
});

run('zero eligible damage skips rolls safely', () => {
  let randomCalls = 0;
  const result = calamityRewards.rollCalamitySupremeRewards([
    { discord_id: 'zero', total_damage: 0 },
  ], { randomInteger: () => { randomCalls += 1; return 0; }, logger: () => {} });
  assert.equal(randomCalls, 0);
  assert.deepEqual(result.winnerIds, []);
  assert.equal(result.totalEligibleDamage, 0);
});

check('Calamity roll uses node crypto randomInt',
  /require\(['"]node:crypto['"]\)/.test(rewardSource)
  && /randomInteger = randomInt/.test(rewardSource)
  && /randomInteger\(0, ROLL_SCALE\)/.test(rewardSource)
  && !/Math\.random\(\)/.test(rewardSource));

check('defeat handler grants guaranteed and independent bonus separately',
  /rollCalamitySupremeRewards\(participantRows\)/.test(bossSource)
  && /supreme_chest = supreme_chest \+ \$2/.test(bossSource)
  && /\$\{chest\.column\} = \$\{chest\.column\} \+ \$4/.test(bossSource));

check('duplicate completion is blocked by the atomic active to dead transition',
  /status = 'dead',[\s\S]*?status = 'active' AND current_hp <= 0/.test(bossSource)
  && /return null; \/\/ already distributed/.test(bossSource));

check('pre-deployment active Calamity uses current completion-time reward config',
  /chest = chestForSpawn\(spawnId, bossName/.test(bossSource)
  && /spawnSource: flip\.rows\[0\]\.spawn_source/.test(bossSource)
  && /CALAMITY_PARTICIPATION_CHEST/.test(fs.readFileSync(path.join(ROOT, 'src', 'config', 'bosses.js'), 'utf8'))
  && !/reward_snapshot|reward_config/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'credd_schema_v4.sql'), 'utf8')));

check('developer spawn bypasses only the spawn official-server guard',
  /bypassOfficialGuard = false/.test(bossSource)
  && /!bypassOfficialGuard && !isOfficialGuild\(guildId\)/.test(bossSource)
  && /bypassOfficialGuard: true/.test(devSource)
  && /isOfficialGuild\(message\.guild\.id\)/.test(bossCommandSource));

check('active boss image refresh resolves the current R2 object version',
  /assetSignatureSync/.test(bossSource)
  && /clearAssetCacheFor\(imgPath\)/.test(bossSource)
  && /bossAssetSignature\(imgPath\)/.test(bossSource)
  && /BANNER_CACHE_MAX_ENTRIES/.test(bossSource)
  && /headObject/.test(bossSource)
  && /forceAssetRefresh/.test(bossSource)
  && /forceAssetRefresh: true/.test(bossCommandSource));

check('duel cleanup clears the specific DB lock and releases before rendering',
  /DELETE FROM active_duel_participants WHERE duel_id = \$1 AND lock_token = \$2/.test(duelLocksSource)
  && /DELETE FROM active_duels WHERE duel_id = \$1 AND lock_token = \$2/.test(duelLocksSource)
  && duelSource.indexOf('await safeReleaseDuelLock(duelLock);') < duelSource.indexOf('let battleSkinPath = null;')
  && /finally \{[\s\S]*?safeReleaseDuelLock\(duelLock\)/.test(duelSource));

console.log(`CALAMITY_REWARDS ${JSON.stringify({ passed, failed, failures })}`);
if (failed > 0) process.exitCode = 1;
