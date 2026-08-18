'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Boss implementation source, layout-agnostic: bossSystem.js plus any modules
 * split out of it under src/engine/boss/. The source-text checks below assert
 * WHAT the boss code says, not WHICH file holds it, so extracting a module
 * must not fail them (Phase 2 refactor).
 */
function readBossSource() {
  const parts = [fs.readFileSync(path.join(ROOT, 'src', 'engine', 'bossSystem.js'), 'utf8')];
  const dir = path.join(ROOT, 'src', 'engine', 'boss');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) {
      parts.push(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  return parts.join('\n');
}

const bosses = require(path.join(ROOT, 'src', 'config', 'bosses'));
const calamityRewards = require(path.join(ROOT, 'src', 'engine', 'calamityRewards'));
const {
  calamityBonusRewardBlock,
  bossBagRewardLine,
  buildBossMessage,
} = require(path.join(ROOT, 'src', 'engine', 'boss', 'bossMessages'));
const rewardSource = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'calamityRewards.js'), 'utf8');
const bossSource = readBossSource();
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

async function runAsync(name, fn) {
  try {
    await fn();
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

run('guaranteed boss bags match every existing spawn variant without inheritance', () => {
  const normal = bosses.bossBagReward('Medusa', bosses.bossChestForSpawn('Medusa'));
  const greater = bosses.bossBagReward('Jotun', {
    column: 'boss_treasure_chest', qty: 2, label: 'Boss Treasure Chest',
  });
  const greater2x = bosses.bossBagReward('Jotun', {
    column: 'boss_golden_chest', qty: 1, label: 'Boss Golden Chest',
  });
  const calamityNatural = bosses.bossBagReward('Fenrir', bosses.bossChestForSpawn('Fenrir', 'natural'));
  const calamityDev = bosses.bossBagReward('Fenrir', bosses.bossChestForSpawn('Fenrir', 'dev'));
  assert.deepEqual(normal, {
    column: 'lesser_rune_bag', qty: 1, label: 'Lesser Bag', emojiName: 'lesser_bag',
  });
  assert.deepEqual(greater, {
    column: 'greater_rune_bag', qty: 1, label: 'Greater Bag', emojiName: 'greater_bag',
  });
  assert.deepEqual(greater2x, {
    column: 'greater_rune_bag', qty: 2, label: 'Greater Bag', emojiName: 'greater_bag',
  });
  assert.equal(greater2x.qty, 2, '2x Greater must not inherit another Greater Bag');
  assert.deepEqual(calamityNatural, {
    column: 'greater_rune_bag', qty: 3, label: 'Greater Bag', emojiName: 'greater_bag',
  });
  assert.deepEqual(calamityDev, calamityNatural);
});

run('existing currency, EXP, shard, and chest rewards remain unchanged', () => {
  const twin = { column: 'boss_treasure_chest', qty: 2 };
  const golden = { column: 'boss_golden_chest', qty: 1 };
  assert.deepEqual(bosses.bossRewards('Medusa'), { credux: 100_000, exp: 20_000, shards: 1_000 });
  assert.deepEqual(bosses.bossRewards('Jotun', twin), { credux: 150_000, exp: 30_000, shards: 1_500 });
  assert.deepEqual(bosses.bossRewards('Jotun', golden), { credux: 200_000, exp: 40_000, shards: 2_000 });
  assert.deepEqual(bosses.bossRewards('Fenrir', golden), { credux: 400_000, exp: 80_000, shards: 4_000 });
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

run('every eligible participant receives two independent rolls at the same threshold', () => {
  const rolls = [];
  const result = calamityRewards.rollCalamitySupremeRewards([
    { discord_id: 'a', total_damage: 3 },
    { discord_id: 'b', total_damage: 2 },
    { discord_id: 'zero', total_damage: 0 },
    { discord_id: 'negative', total_damage: -1 },
  ], { randomInteger: (min, max) => { rolls.push([min, max]); return 0; }, logger: () => {} });
  assert.equal(rolls.length, 4);
  assert.deepEqual(result.winnerIds, ['a', 'b']);
  assert.deepEqual(result.supremeWinnerIds, ['a', 'b']);
  assert.deepEqual(result.divineWinnerIds, ['a', 'b']);
  assert.equal(result.rolls.every((roll) => roll.supremeChestGranted === 1), true);
  assert.equal(result.rolls.every((roll) => roll.divineBagGranted === 1), true);
  assert.equal(result.rolls.every((roll) => roll.calculatedThreshold > 0), true);
});

run('Supreme and Divine independent rolls allow all four outcomes', () => {
  const low = 0;
  const high = calamityRewards.ROLL_SCALE - 1;
  const firstParticipant = (supremeRoll, divineRoll) => {
    const draws = [supremeRoll, divineRoll, high, high];
    const result = calamityRewards.rollCalamitySupremeRewards([
      { discord_id: 'target', total_damage: 1 },
      { discord_id: 'other', total_damage: 1 },
    ], { randomInteger: () => draws.shift(), logger: () => {} });
    return result.rolls[0];
  };
  const both = firstParticipant(low, low);
  const supremeOnly = firstParticipant(low, high);
  const divineOnly = firstParticipant(high, low);
  const neither = firstParticipant(high, high);
  assert.deepEqual(
    [both.supremeSuccess, both.divineSuccess],
    [true, true],
  );
  assert.deepEqual(
    [supremeOnly.supremeSuccess, supremeOnly.divineSuccess],
    [true, false],
  );
  assert.deepEqual(
    [divineOnly.supremeSuccess, divineOnly.divineSuccess],
    [false, true],
  );
  assert.deepEqual(
    [neither.supremeSuccess, neither.divineSuccess],
    [false, false],
  );
});

run('reward display uses credited quantities and hides failed Calamity bonuses', () => {
  const normal = bosses.bossBagReward('Medusa');
  const greater = bosses.bossBagReward('Jotun', { column: 'boss_treasure_chest', qty: 2 });
  const greater2x = bosses.bossBagReward('Jotun', { column: 'boss_golden_chest', qty: 1 });
  const calamity = bosses.bossBagReward('Fenrir');
  assert(bossBagRewardLine(normal).includes('Lesser Bag ×1'));
  assert(bossBagRewardLine(greater).includes('Greater Bag ×1'));
  assert(bossBagRewardLine(greater2x).includes('Greater Bag ×2'));
  assert(bossBagRewardLine(calamity).includes('Greater Bag ×3'));

  const neither = calamityBonusRewardBlock('dead', {
    supremeWinnerIds: [], divineWinnerIds: [],
  });
  const supremeOnly = calamityBonusRewardBlock('dead', {
    supremeWinnerIds: ['a'], divineWinnerIds: [],
  });
  const divineOnly = calamityBonusRewardBlock('dead', {
    supremeWinnerIds: [], divineWinnerIds: ['a'],
  });
  const both = calamityBonusRewardBlock('dead', {
    supremeWinnerIds: ['a'], divineWinnerIds: ['b'],
  });
  const threeUsers = calamityBonusRewardBlock('dead', {
    supremeWinnerIds: ['a', 'b', 'c'], divineWinnerIds: ['a', 'b', 'c'],
  });
  assert.equal(neither, '');
  assert(supremeOnly.includes('Supreme Chest ×1 each · 1 User') && !supremeOnly.includes('Divine Bag'));
  assert(divineOnly.includes('Divine Bag ×1 each · 1 User') && !divineOnly.includes('Supreme Chest'));
  assert(both.includes('Supreme Chest ×1 each · 1 User') && both.includes('Divine Bag ×1 each · 1 User'));
  assert(threeUsers.includes('Supreme Chest ×1 each · 3 Users'));
  assert(threeUsers.includes('Divine Bag ×1 each · 3 Users'));
  assert(!threeUsers.includes('winner'));
  const preview = calamityBonusRewardBlock('active');
  assert(preview.includes('Supreme Chest ×1') && preview.includes('Divine Bag ×1'));
  assert(preview.includes('Two independent chances'));
});

run('zero eligible damage skips rolls safely', () => {
  let randomCalls = 0;
  const result = calamityRewards.rollCalamitySupremeRewards([
    { discord_id: 'zero', total_damage: 0 },
  ], { randomInteger: () => { randomCalls += 1; return 0; }, logger: () => {} });
  assert.equal(randomCalls, 0);
  assert.deepEqual(result.winnerIds, []);
  assert.deepEqual(result.divineWinnerIds, []);
  assert.equal(result.totalEligibleDamage, 0);
});

check('Calamity roll uses node crypto randomInt',
  /require\(['"]node:crypto['"]\)/.test(rewardSource)
  && /randomInteger = randomInt/.test(rewardSource)
  && /randomInteger\(0, ROLL_SCALE\)/.test(rewardSource)
  && !/Math\.random\(\)/.test(rewardSource));

check('defeat handler grants guaranteed and independent bonus separately',
  /rollCalamitySupremeRewards\(participantRows\)/.test(bossSource)
  && /\$\{SUPREME_CHEST_REWARD\.column\} = \$\{SUPREME_CHEST_REWARD\.column\} \+ \$2/.test(bossSource)
  && /\$\{DIVINE_BAG_REWARD\.column\} = \$\{DIVINE_BAG_REWARD\.column\} \+ \$2/.test(bossSource)
  && /\$\{chest\.column\} = \$\{chest\.column\} \+ \$4/.test(bossSource)
  && /\$\{bagReward\.column\} = \$\{bagReward\.column\} \+ \$5/.test(bossSource));

check('Divine winners flow through selection, inventory, and final rendering',
  /divineWinnerIds = rolls\.divineWinnerIds/.test(bossSource)
  && /\$\{DIVINE_BAG_REWARD\.column\} = \$\{DIVINE_BAG_REWARD\.column\} \+ \$2/.test(bossSource)
  && /bonusRewardResults: \{ supremeWinnerIds, divineWinnerIds \}/.test(bossSource)
  && /grantedCalamityBonusRewards\(\{ supremeWinnerIds, divineWinnerIds \}\)/.test(bossSource));

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

function bossView(name, { spawnId, hpMultiplier = 1, status = 'active' }) {
  const baseHp = 100;
  return {
    state: {
      guild_id: 'guild', spawn_id: spawnId, max_hp: baseHp * hpMultiplier,
      current_hp: status === 'dead' ? 0 : baseHp * hpMultiplier,
      scaled_atk: 10, scaled_def: 5, status, spawn_source: 'natural',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    mobRow: {
      name, mythology: 'Greek', base_hp: baseHp, base_atk: 10, base_def: 5,
      base_crit: 0, skill_name: null, skill_description: null,
    },
    attackers: [], attackerCount: 0, isDev: false,
  };
}

async function finish() {
  await runAsync('live boss payload renders exact guaranteed bags and successful bonuses', async () => {
    const options = { includeStatusImage: false, includeBanner: false };
    const normal = await buildBossMessage(
      bossView('Medusa', { spawnId: 'normal' }), options,
    );
    const greater2x = await buildBossMessage(
      bossView('Jotun', { spawnId: 'greater-2x', hpMultiplier: 2 }), options,
    );
    const calamity = await buildBossMessage(
      bossView('Fenrir', { spawnId: 'calamity', status: 'dead' }),
      {
        ...options,
        bonusRewardResults: { supremeWinnerIds: ['a'], divineWinnerIds: ['b'] },
      },
    );
    const normalText = JSON.stringify(normal.components[0].toJSON());
    const greaterText = JSON.stringify(greater2x.components[0].toJSON());
    const calamityText = JSON.stringify(calamity.components[0].toJSON());
    assert(normalText.includes('Lesser Bag ×1') && normalText.includes('lesser_bag'));
    assert(greaterText.includes('Greater Bag ×2') && greaterText.includes('greater_bag'));
    assert(calamityText.includes('Greater Bag ×3'));
    assert(calamityText.includes('Supreme Chest ×1') && calamityText.includes('Divine Bag ×1'));
  });

  console.log(`CALAMITY_REWARDS ${JSON.stringify({ passed, failed, failures })}`);
  if (failed > 0) process.exitCode = 1;
}

finish().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
