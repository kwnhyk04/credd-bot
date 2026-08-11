'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  CALAMITY_SPAWN_CHANCE,
  GREATER_SPAWN_CHANCE,
  NORMAL_SPAWN_CHANCE,
  selectWeightedBossPool,
  rotationCandidates,
  pickBossFromPool,
  pickWeightedBoss,
} = require('../src/config/bosses');

const normalPool = [
  { mob_id: 1, name: 'Berberoka' },
  { mob_id: 2, name: 'Hydra' },
  { mob_id: 3, name: 'Anggitay' },
  { mob_id: 4, name: 'Dalaketnon' },
  { mob_id: 5, name: 'Medusa' },
  { mob_id: 6, name: 'Bungisngis' },
  { mob_id: 7, name: 'Sleipnir' },
];

function stateFromHistory(pool, history) {
  const eligible = new Set(pool.map((row) => row.mob_id));
  const matching = history.filter((mobId) => eligible.has(mobId));
  return {
    recentMobIds: matching.slice(-pool.length).reverse(),
    totalSpawns: matching.length,
  };
}

function simulateRestarts(pool, count, rng = () => 0) {
  const history = [];
  for (let index = 0; index < count; index += 1) {
    // Recreate the state object on every draw, as a process restart would.
    const pick = pickBossFromPool(pool, stateFromHistory(pool, history), rng);
    assert(pick?.row, `selection ${index + 1} returned no boss`);
    history.push(pick.row.mob_id);
  }
  return history;
}

function assertCompleteBagsAreUnique(history, size) {
  for (let start = 0; start + size <= history.length; start += size) {
    const bag = history.slice(start, start + size);
    assert.equal(new Set(bag).size, size, `repeated boss in bag ${bag.join(',')}`);
  }
}

function main() {
  assert.equal(CALAMITY_SPAWN_CHANCE, 0.05);
  assert.equal(GREATER_SPAWN_CHANCE, 0.25);
  assert.equal(NORMAL_SPAWN_CHANCE, 0.70);

  const tierRows = [
    { mob_id: 10, name: 'Fenrir' },
    { mob_id: 11, name: 'Jotun' },
    { mob_id: 12, name: 'Hydra' },
  ];
  assert.equal(selectWeightedBossPool(tierRows, () => 0.049999)[0].name, 'Fenrir');
  assert.equal(selectWeightedBossPool(tierRows, () => 0.05)[0].name, 'Jotun');
  assert.equal(selectWeightedBossPool(tierRows, () => 0.299999)[0].name, 'Jotun');
  assert.equal(selectWeightedBossPool(tierRows, () => 0.30)[0].name, 'Hydra');

  let rolls = [0.30, 0];
  assert.equal(pickWeightedBoss(tierRows, () => rolls.shift()).row.name, 'Hydra');

  const twenty = simulateRestarts(normalPool, 20, () => 0);
  assertCompleteBagsAreUnique(twenty, normalPool.length);
  for (let index = 1; index < twenty.length; index += 1) {
    assert.notEqual(twenty[index], twenty[index - 1], 'cycle boundary repeated immediately');
  }

  assert.deepEqual(simulateRestarts([normalPool[0]], 20), Array(20).fill(1));
  const pair = simulateRestarts(normalPool.slice(0, 2), 20);
  assertCompleteBagsAreUnique(pair, 2);
  for (let index = 1; index < pair.length; index += 1) {
    assert.notEqual(pair[index], pair[index - 1]);
  }

  const priorHistory = [1, 2, 3, 1, 2];
  const addedPool = [...normalPool];
  const afterAdd = pickBossFromPool(addedPool, stateFromHistory(addedPool, priorHistory), () => 0.75);
  assert(addedPool.some((row) => row.mob_id === afterAdd.row.mob_id));
  const removedPool = [normalPool[1], normalPool[3]];
  const afterRemove = pickBossFromPool(removedPool, stateFromHistory(removedPool, priorHistory), () => 0.75);
  assert(removedPool.some((row) => row.mob_id === afterRemove.row.mob_id));
  assert.deepEqual(rotationCandidates([], {}), []);

  const configSource = fs.readFileSync(path.join(ROOT, 'src', 'config', 'bosses.js'), 'utf8');
  const progressSource = fs.readFileSync(
    path.join(ROOT, 'src', 'engine', 'boss', 'bossProgress.js'),
    'utf8',
  );
  assert(configSource.includes("const { chance, int, unit } = require('../utils/secureRng')"));
  assert(!configSource.includes('chance(1)'));
  assert(progressSource.includes('FROM boss_attack_log bal'));
  assert(progressSource.includes('FROM boss_spawn_queue q'));
  assert(progressSource.includes("bs.spawn_source = 'dev'"));
  assert(progressSource.includes("if (source === 'natural')"));
  assert(progressSource.includes('pick = pickWeightedBoss(allBosses)'));
  assert(/if \(bossName\)[\s\S]*?fetchMobByName\(pool, bossName\)[\s\S]*?else \{/.test(progressSource));
  assert(/ON CONFLICT \(guild_id\) DO UPDATE SET[\s\S]*?WHERE boss_state\.status <> 'active'/.test(progressSource));

  console.log('BOSS ROTATION SELFTEST: passed (20 restart-reconstructed selections)');
}

main();
