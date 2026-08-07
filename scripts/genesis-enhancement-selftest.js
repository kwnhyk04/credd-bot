'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  MAX_ENHANCEMENT,
  GENESIS_MAX_ENHANCEMENT,
  GENESIS_POST_10_STEP,
  ENHANCE_COST,
  maxStoredEnhancement,
  maxDisplayEnhancement,
  computeWeaponStats,
  computeArmorStats,
  nextAttempt,
  successfulEnhancementCost,
} = require('../src/engine/enhancement');
const { buildForgePayload } = require('../src/commands/rpg/enhance');

function main() {
  assert.equal(MAX_ENHANCEMENT, 11);
  assert.equal(GENESIS_MAX_ENHANCEMENT, 21);
  assert.equal(GENESIS_POST_10_STEP, 0.10);
  assert.equal(maxStoredEnhancement('Genesis'), 21);
  assert.equal(maxDisplayEnhancement('Genesis'), 20);
  assert.equal(maxStoredEnhancement('Supreme'), 11);
  assert.equal(maxDisplayEnhancement('Supreme'), 10);
  assert.equal(maxStoredEnhancement('Genesis', 'armor'), 11);
  assert.equal(maxDisplayEnhancement('Genesis', 'armor'), 10);

  for (let target = 11; target <= 20; target += 1) {
    assert.equal(ENHANCE_COST.Genesis[target], ENHANCE_COST.Supreme[10]);
    assert.deepEqual(nextAttempt('Genesis', target), {
      targetLevel: target,
      cost: 3_000_000,
      successRate: 0.1,
    });
  }

  assert.equal(nextAttempt('Genesis', 21), null);
  assert.equal(nextAttempt('Genesis', 11, 'armor'), null);
  assert.equal(nextAttempt('Supreme', 11), null);
  assert.equal(nextAttempt('Legendary', 11), null);
  assert.equal(nextAttempt('Common', 1), null);

  for (let displayLevel = 10; displayLevel <= 20; displayLevel += 1) {
    assert.deepEqual(
      computeWeaponStats({ base_atk: 1_600, tier: 'Genesis' }, displayLevel + 1),
      { curr_atk: 3_200 + 320 * (displayLevel - 10) },
      `Genesis +${displayLevel} must add 10% of its +10 ATK per post-10 level`,
    );
  }
  assert.deepEqual(
    computeWeaponStats({ base_atk: 1_001, tier: 'Genesis' }, 12),
    { curr_atk: 2_202 },
    'Genesis +11 step must be based on the floored +10 stat, not +0/base ATK',
  );
  const forgePayload = buildForgePayload({
    kind: 'weapon',
    name: 'Kiri',
    type: 'Sword',
    tier: 'Genesis',
    enhancement: 11,
    base_atk: 1_600,
    curr_atk: 3_200,
    credux: 10_000_000,
  }, 'kiri-id', 'owner-id');
  const forgeJson = JSON.stringify(forgePayload.components.map((component) => component.toJSON()));
  assert(forgeJson.includes('On success → ATK 3520'));
  assert.throws(
    () => computeWeaponStats({ base_atk: 1_600, tier: 'Supreme' }, 12),
    /invalid enhancement/,
  );
  assert.throws(
    () => computeArmorStats({ base_hp: 1_000, base_def: 500 }, 12),
    /invalid enhancement/,
  );

  assert.equal(successfulEnhancementCost('Supreme', 11), 12_900_000);
  assert.equal(successfulEnhancementCost('Genesis', 21), 42_900_000);

  const migration = fs.readFileSync(
    path.join(__dirname, 'migrations', '20260721_10_genesis_enhancement_cap.sql'),
    'utf8',
  );
  assert.match(migration, /CHECK \(enhancement >= 1 AND enhancement <= 21\)/);
  assert.match(migration, /wr\.tier <> 'Genesis' AND uw\.enhancement > 11/);

  const statMigration = fs.readFileSync(
    path.join(__dirname, 'migrations', '20260721_12_genesis_post10_stats.sql'),
    'utf8',
  );
  assert.match(statMigration, /wr\.tier = 'Genesis'/);
  assert.match(statMigration, /uw\.enhancement BETWEEN 12 AND 21/);
  assert.match(
    statMigration,
    /floor\(floor\(uw\.base_atk::numeric \* 2\.0\) \* 0\.10\)[\s\S]*?\* \(uw\.enhancement - 11\)/,
  );
  assert.match(statMigration, /uw\.curr_atk IS DISTINCT FROM expected\.curr_atk/);

  const rollback = fs.readFileSync(
    path.join(__dirname, 'migrations', '20260720_09_rollback.sql'),
    'utf8',
  );
  assert.match(rollback, /\[12\][\s\S]*?SET curr_atk = floor\(uw\.base_atk::numeric \* 2\.0\)::integer/);

  const enhanceSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'commands', 'rpg', 'enhance.js'),
    'utf8',
  );
  assert.match(enhanceSource, /maxDisplayEnhancement\(g\.tier, g\.kind\)/);
  assert.match(enhanceSource, /computeWeaponStats\(g, level\)/);
  assert.match(enhanceSource, /computeWeaponStats\(g, newEnhancement\)/);

  const devSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'commands', 'rpg', 'dev.js'),
    'utf8',
  );
  assert.match(devSource, /const maxLevel = maxDisplayEnhancement\(w\.tier\)/);
  assert.match(devSource, /const stats = computeWeaponStats\(w, stored\)/);
  assert.match(devSource, /Armors can only be enhanced to \*\*\+10\*\*/);

  console.log('GENESIS ENHANCEMENT SELFTEST: passed');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
