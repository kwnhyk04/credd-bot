'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PASSIVES = require('../src/engine/passiveRegistry');
const { resolveBattle } = require('../src/engine/battleEngine');
const {
  DIVINE_BLESSING_DEITIES,
  ECHO_BLESSING_DEITIES,
  ECHO_BLESSING_KEY_MAP,
  resolveBlessingSlots,
} = require('../src/config/blessings');
const { DEITY_UPDATES } = require('./update-final-passive-descriptions');

const DIVINE_KEY_BY_NAME = Object.freeze({
  Zeus: 'zeus_thunder_sovereign',
  Athena: 'athena_aegis_shield',
  Artemis: 'artemis_huntress_precision',
  Aphrodite: 'aphrodite_enchanting_aura',
  Poseidon: 'poseidon_tidal_force',
  Dionysus: 'dionysus_drunken_haze',
  Odin: 'odin_all_fathers_wisdom',
  Thor: 'thor_mjolnirs_wrath',
  Loki: 'loki_illusory_double',
  Skadi: 'skadi_winters_hunt',
  Baldur: 'baldur_invulnerability',
  Heimdall: 'heimdall_eternal_vigilance',
  Bathala: 'bathala_divine_vessel',
  Sidapa: 'sidapa_deaths_reprieve',
  Amihan: 'amihan_tailwind',
});

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function player(overrides = {}) {
  return {
    name: 'Auditor',
    kind: 'player',
    class: 'Knight',
    classPassive: null,
    level: 50,
    atk: 320,
    hp: 2400,
    def: 140,
    crit: 20,
    bonusDmgPct: 0,
    weaponPassiveKey: 'none',
    weaponName: null,
    weaponTier: null,
    armorPassiveKey: 'none',
    deityBlessingKey: 'none',
    echoBlessingKey: 'none',
    ...overrides,
  };
}

function opponent(mode) {
  if (mode === 'duel') {
    return player({
      name: 'Opponent',
      atk: 260,
      hp: 2600,
      def: 120,
      crit: 15,
    });
  }
  return {
    name: mode === 'boss' ? 'Audit Boss' : 'Audit Mob',
    kind: 'mob',
    mobType: mode === 'boss' ? 'boss' : 'regular',
    level: 50,
    atk: 230,
    hp: 5200,
    def: 110,
    crit: 15,
    skillKey: 'none',
    immunityTags: [],
    specialFlags: {},
  };
}

function assertFiniteBattle(sim, label) {
  assert(sim && Array.isArray(sim.rounds), `${label}: missing round output`);
  assert(sim.rounds.length >= 1 && sim.rounds.length <= 50,
    `${label}: invalid round count ${sim.rounds.length}`);
  assert(['a', 'b', 'draw'].includes(sim.winner), `${label}: invalid winner ${sim.winner}`);
  assert(Number.isFinite(sim.a.hp) && Number.isFinite(sim.a.maxHp), `${label}: invalid player HP`);
  assert(Number.isFinite(sim.b.hp) && Number.isFinite(sim.b.maxHp), `${label}: invalid opponent HP`);
  for (const round of sim.rounds) {
    assert(Number.isInteger(round.round) && Array.isArray(round.events), `${label}: malformed round`);
    assert(round.events.every((event) => typeof event === 'string'), `${label}: non-text event`);
  }
}

function sqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function main() {
  const divineNames = Object.keys(DIVINE_KEY_BY_NAME);
  const echoNames = Object.keys(ECHO_BLESSING_KEY_MAP);

  assert.equal(divineNames.length, 15);
  assert.equal(echoNames.length, 26);
  assert.deepEqual(sorted(DIVINE_BLESSING_DEITIES), sorted(divineNames));
  assert.deepEqual(sorted(ECHO_BLESSING_DEITIES), sorted(echoNames));
  assert.equal(new Set([...divineNames, ...echoNames]).size, 41,
    'every deity must belong to exactly one blessing type');

  const echoUpdates = DEITY_UPDATES.filter((entry) => entry.runtimeKey);
  assert.equal(echoUpdates.length, 26, 'all Echo-type roster descriptions must target their runtime key');
  assert.deepEqual(sorted(echoUpdates.map((entry) => entry.name)), sorted(echoNames));

  const originalKeyByEchoName = new Map(echoUpdates.map((entry) => [entry.name, entry.key]));
  for (const name of divineNames) {
    const key = DIVINE_KEY_BY_NAME[name];
    assert.equal(typeof PASSIVES[key], 'function', `missing Divine handler ${key}`);
    assert.equal(resolveBlessingSlots({
      slot1Name: name,
      slot1BlessingName: name,
      slot1BlessingKey: key,
      slot1Ascended: true,
    }).primary.key, key, `${name} must keep its Divine key in slot 1`);
    assert.equal(resolveBlessingSlots({
      slot1Name: name,
      slot1BlessingKey: key,
      slot1Ascended: false,
    }).primary.key, 'none', `${name} must remain dormant before Ascension`);
  }

  for (const name of echoNames) {
    const runtimeKey = ECHO_BLESSING_KEY_MAP[name];
    const originalKey = originalKeyByEchoName.get(name);
    const update = echoUpdates.find((entry) => entry.name === name);
    assert(originalKey, `${name} is missing its stored roster key`);
    assert.equal(update.runtimeKey, runtimeKey, `${name} description targets the wrong runtime key`);
    assert.equal(typeof PASSIVES[runtimeKey], 'function', `missing Echo handler ${runtimeKey}`);

    const primary = resolveBlessingSlots({
      slot1Name: name,
      slot1BlessingName: name,
      slot1BlessingKey: originalKey,
      slot1Ascended: true,
    });
    assert.equal(primary.primary.key, runtimeKey, `${name} must map to ${runtimeKey} in slot 1`);

    const secondary = resolveBlessingSlots({
      echoName: name,
      echoBlessingName: name,
      echoBlessingKey: originalKey,
      echoAscended: true,
    });
    assert.equal(secondary.secondary.key, runtimeKey, `${name} must map to ${runtimeKey} as Echo`);
    assert.equal(resolveBlessingSlots({
      echoName: name,
      echoBlessingKey: originalKey,
      echoAscended: false,
    }).secondary.key, 'none', `${name} Echo must remain dormant before Ascension`);
  }

  const ledger = fs.readFileSync(path.join(ROOT, 'assets', 'data', 'passive_registry_keys.md'), 'utf8');
  const ledgerKeys = new Set([...ledger.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1]));
  const activeKeys = [...Object.values(DIVINE_KEY_BY_NAME), ...Object.values(ECHO_BLESSING_KEY_MAP)];
  assert.equal(new Set(activeKeys).size, 41);
  for (const key of activeKeys) assert(ledgerKeys.has(key), `passive ledger missing ${key}`);

  // Every active key is executed through every simulated combat mode. Echo keys
  // are also exercised in both channels because the engine calls those channels
  // independently and their ordering is part of the public combat contract.
  const modes = ['raid', 'boss', 'duel'];
  let seed = 8_190;
  for (const [name, key] of Object.entries(DIVINE_KEY_BY_NAME)) {
    for (const mode of modes) {
      const sim = resolveBattle(
        player({ deityName: name, deityBlessingKey: key }),
        opponent(mode),
        { mode, seed: seed += 1 },
      );
      assertFiniteBattle(sim, `${mode}/${name}/${key}/primary`);
    }
  }
  for (const [name, key] of Object.entries(ECHO_BLESSING_KEY_MAP)) {
    for (const mode of modes) {
      const primary = resolveBattle(
        player({ deityName: name, deityBlessingKey: key }),
        opponent(mode),
        { mode, seed: seed += 1 },
      );
      assertFiniteBattle(primary, `${mode}/${name}/${key}/primary`);

      const secondary = resolveBattle(
        player({ echoDeityName: name, echoBlessingKey: key }),
        opponent(mode),
        { mode, seed: seed += 1 },
      );
      assertFiniteBattle(secondary, `${mode}/${name}/${key}/secondary`);
    }
  }

  const migration = fs.readFileSync(
    path.join(__dirname, 'migrations', '20260819_01_passive_audit_descriptions.sql'),
    'utf8',
  );
  assert.match(migration, /roster_type = 'deity'\) <> 26/);
  assert.match(migration, /roster_type = 'weapon'\) <> 1/);
  for (const entry of echoUpdates) {
    const tuplePrefix = `('deity', '${sqlLiteral(entry.name)}', '${sqlLiteral(entry.key)}', '${entry.runtimeKey}'`;
    assert(migration.includes(tuplePrefix), `description migration missing ${entry.name}`);
    assert(migration.includes(sqlLiteral(entry.description)), `description migration text differs for ${entry.name}`);
  }
  assert(migration.includes("('weapon', 'Alan''s Reversed Hands', 'alans_reversed_hands'"));

  console.log(`DEITY PASSIVE SELFTEST: passed (${activeKeys.length} active keys; 201 mode/channel battles)`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
