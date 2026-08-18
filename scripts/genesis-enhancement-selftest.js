'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  MAX_ENHANCEMENT,
  DIVINE_MAX_ENHANCEMENT,
  DIVINE_PRE_10_STEP,
  DIVINE_POST_10_STEP,
  ENHANCE_COST,
  maxStoredEnhancement,
  maxDisplayEnhancement,
  computeWeaponStats,
  computeArmorStats,
  nextAttempt,
  successfulEnhancementCost,
} = require('../src/engine/enhancement');
const { buildForgePayload } = require('../src/commands/rpg/enhance');
const {
  relativeThumbnailCandidatesFor,
  DEFAULT_EQUIPMENT_ASSET_DIR,
  DIVINE_WEAPON_ASSET_DIR,
  TIER_COLOR: EQUIPMENT_TIER_COLOR,
} = require('../src/commands/rpg/equipment');

function main() {
  assert.equal(MAX_ENHANCEMENT, 11);
  assert.equal(DIVINE_MAX_ENHANCEMENT, 21);
  assert.equal(DIVINE_PRE_10_STEP, 0.10);
  assert.equal(DIVINE_POST_10_STEP, 0.20);
  assert.equal(maxStoredEnhancement('Divine'), 21);
  assert.equal(maxDisplayEnhancement('Divine'), 20);
  assert.equal(maxStoredEnhancement('Supreme'), 11);
  assert.equal(maxDisplayEnhancement('Supreme'), 10);
  assert.equal(maxStoredEnhancement('Divine', 'armor'), 11);
  assert.equal(maxDisplayEnhancement('Divine', 'armor'), 10);

  assert.equal(DIVINE_WEAPON_ASSET_DIR, 'weapons/divine');
  assert.equal(DEFAULT_EQUIPMENT_ASSET_DIR, 'weapons');
  assert.equal(EQUIPMENT_TIER_COLOR.Divine, 0xffffff);
  const divineWeaponCandidates = relativeThumbnailCandidatesFor({
    kind: 'weapon',
    tier: 'Divine',
    name: 'Kiri',
    image_filename: 'kiri.png',
  });
  assert.deepEqual(divineWeaponCandidates[0], {
    relativePath: 'weapons/divine/kiri.png',
    thumbnailVariant: false,
  });
  assert.equal(
    divineWeaponCandidates.some((candidate) => /genesis/i.test(candidate.relativePath)),
    false,
    'Divine weapon image candidates must never probe the retired Genesis folder',
  );
  assert.equal(
    relativeThumbnailCandidatesFor({
      kind: 'weapon',
      tier: 'Supreme',
      name: 'Mantle of Bathala',
      image_filename: 'mantle_of_bathala.jpg',
    })[0].relativePath,
    'weapons/thumbnails/mantle_of_bathala.webp',
    'non-Divine weapon assets must keep the existing flat weapons namespace',
  );

  for (let target = 11; target <= 20; target += 1) {
    assert.equal(ENHANCE_COST.Divine[target], ENHANCE_COST.Supreme[10]);
    assert.deepEqual(nextAttempt('Divine', target), {
      targetLevel: target,
      cost: 3_000_000,
      successRate: 0.1,
    });
  }

  assert.equal(nextAttempt('Divine', 21), null);
  assert.equal(nextAttempt('Divine', 11, 'armor'), null);
  assert.equal(nextAttempt('Supreme', 11), null);
  assert.equal(nextAttempt('Legendary', 11), null);
  assert.equal(nextAttempt('Common', 1), null);

  for (let displayLevel = 0; displayLevel <= 20; displayLevel += 1) {
    const expectedMultiplier = displayLevel <= 10
      ? 1 + displayLevel * 0.10
      : 2 + (displayLevel - 10) * 0.20;
    assert.deepEqual(
      computeWeaponStats({ base_atk: 1_600, tier: 'Divine' }, displayLevel + 1),
      { curr_atk: Math.floor(1_600 * expectedMultiplier) },
      `Divine +${displayLevel} must use the tier's 10%/20% breakpoint`,
    );
  }
  assert.equal(computeWeaponStats({ base_atk: 1_600, tier: 'Divine' }, 11).curr_atk, 3_200);
  assert.equal(computeWeaponStats({ base_atk: 1_600, tier: 'Divine' }, 12).curr_atk, 3_520);
  assert.equal(computeWeaponStats({ base_atk: 1_600, tier: 'Divine' }, 16).curr_atk, 4_800);
  assert.equal(computeWeaponStats({ base_atk: 1_600, tier: 'Divine' }, 21).curr_atk, 6_400);
  assert.deepEqual(
    computeWeaponStats({ base_atk: 1_001, tier: 'Divine' }, 12),
    { curr_atk: 2_202 },
    'Divine +11 must equal +120% over base ATK',
  );
  const forgePayload = buildForgePayload({
    kind: 'weapon',
    name: 'Kiri',
    type: 'Sword',
    tier: 'Divine',
    enhancement: 11,
    base_atk: 1_600,
    curr_atk: 3_200,
    credux: 10_000_000,
  }, 'kiri-id', 'owner-id');
  const forgeJson = JSON.stringify(forgePayload.components.map((component) => component.toJSON()));
  assert(forgeJson.includes('On success → ATK 3520'));
  assert.equal(forgePayload.components[0].toJSON().accent_color, 0xffffff);
  assert.throws(
    () => computeWeaponStats({ base_atk: 1_600, tier: 'Supreme' }, 12),
    /invalid enhancement/,
  );
  assert.throws(
    () => computeArmorStats({ base_hp: 1_000, base_def: 500 }, 12),
    /invalid enhancement/,
  );

  assert.equal(successfulEnhancementCost('Supreme', 11), 12_900_000);
  assert.equal(successfulEnhancementCost('Divine', 21), 42_900_000);

  const migration = fs.readFileSync(
    path.join(__dirname, 'migrations', '20260721_10_genesis_enhancement_cap.sql'),
    'utf8',
  );
  assert.match(migration, /CHECK \(enhancement >= 1 AND enhancement <= 21\)/);
  assert.match(migration, /wr\.tier <> 'Genesis' AND uw\.enhancement > 11/);

  const statMigration = fs.readFileSync(
    path.join(__dirname, 'migrations', '20260818_02_divine_weapon_tier.sql'),
    'utf8',
  );
  assert.match(statMigration, /SET tier = 'Divine'/);
  assert.match(statMigration, /WHERE tier = 'Genesis'/);
  assert.match(statMigration, /weapons\/divine\//);
  assert.match(statMigration, /SET image_filename = expected\.image_filename/);
  assert.match(statMigration, /regexp_replace\([\s\S]*?'\^\\\[Genesis\\\]'[\s\S]*?'\[Divine\]'/);
  for (const filename of ['kiri.png', 'moira.png', 'sophia.png', 'atlas.png', 'titan.png']) {
    assert(statMigration.includes(`'${filename}'`));
  }
  assert.match(statMigration, /wr\.tier = 'Divine'/);
  assert.match(statMigration, /uw\.enhancement BETWEEN 1 AND 21/);
  assert.match(statMigration, /\(uw\.enhancement - 11\) \* 0\.20/);
  assert.match(statMigration, /uw\.curr_atk IS DISTINCT FROM floor\(/);

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

  const equipmentSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'commands', 'rpg', 'equipment.js'),
    'utf8',
  );
  assert.match(equipmentSource, /wr\.image_filename/);
  assert.match(equipmentSource, /thumbnailUrlFor\(g,/);

  const devSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'commands', 'rpg', 'dev.js'),
    'utf8',
  );
  assert.match(devSource, /const maxLevel = maxDisplayEnhancement\(w\.tier\)/);
  assert.match(devSource, /const stats = computeWeaponStats\(w, stored\)/);
  assert.match(devSource, /Armors can only be enhanced to \*\*\+10\*\*/);

  console.log('DIVINE ENHANCEMENT SELFTEST: passed');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
