'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../src/db/pool');

const DEITY_UPDATES = Object.freeze([
  { name: 'Magwayen', key: 'magwayen_soul_drain', description: 'Heals 15% of all damage dealt. When an enemy is defeated, recover 20% max HP as their soul is claimed.' },
  { name: 'Mandarangan', key: 'mandarangan_war_frenzy', description: 'End of each turn: +10% ATK, stacking up to +50% (reached turn 5). Stacks persist all battle.' },
  { name: 'Sidapa', key: 'sidapa_deaths_reprieve', description: 'Once per battle, the first lethal hit leaves the user at 1 HP. The user then heals 30% max HP and gains +50% ATK for the rest of the battle.' },
  { name: 'Apolaki', key: 'apolaki_solar_burn', description: "Each attack burns the enemy for 10% of the user's base ATK for 1 turn." },
  { name: 'Dian Masalanta', key: 'dian_masalanta_devotion', description: 'While below 50% HP, ATK +30% and heal 4% max HP each turn.' },
  { name: 'Mayari', key: 'mayari_lunar_veil', description: 'While below 50% HP, DEF +30% and reflect 15% of damage taken.' },
  { name: 'Amihan', key: 'amihan_tailwind', description: '20% chance to evade any incoming attack. Each successful evade grants +20% ATK to her next attack.' },
  { name: 'Habagat', key: 'habagat_monsoon_fury', description: "At the start of each turn, 25% chance to empower this turn's attack, causing it to deal +50% bonus damage." },
  { name: 'Idiyanale', key: 'idiyanale_persistence', description: 'Every 3rd turn, the next attack deals +75% more damage.' },
  { name: 'Lakapati', key: 'lakapati_abundance', description: 'Regenerates 3% max HP at the start of each turn.' },

  { name: 'Freya', key: 'freya_valkyries_embrace', description: 'ATK +30% for the whole battle. Once per battle, at 40% HP or below, restore 20% max HP.' },
  { name: 'Loki', key: 'loki_illusory_double', description: '25% chance each turn to evade an attack and counter for 100% ATK.' },
  { name: 'Skadi', key: 'skadi_winters_hunt', description: "Each attack has a 30% chance to Freeze the enemy, causing it to skip its next turn. After Freeze ends, the enemy suffers Frostbite, taking 50% more damage for 1 turn." },
  { name: 'Surt', key: 'surt_muspells_flame', description: "Each attack adds Burn equal to 5% of the user's base ATK per turn for 2 turns, stacking up to 30%. Attacks deal 50% more damage to enemies that are already burning." },
  { name: 'Thor', key: 'thor_mjolnirs_wrath', description: "Each attack has a 30% chance to Stun the enemy and Paralyze it for 3 turns. While Paralyzed, the enemy takes damage equal to 20% of the user's base ATK each turn and has a 10% chance to skip its turn." },
  { name: 'Tyr', key: 'tyr_oathkeeper', description: 'DEF +30% for the whole battle; while below 50% HP, reflects 20% of incoming damage.' },
  { name: 'Baldur', key: 'baldur_invulnerability', description: 'Once per battle, the first time the user is debuffed or drops below 50% HP, remove all debuffs, restore 15% max HP, and reduce damage taken by 50% for 1 turn.' },
  { name: 'Heimdall', key: 'heimdall_eternal_vigilance', description: 'The first hit taken each battle is reduced by 50%. For the rest of the battle, damage from incoming critical hits is reduced by 30%.' },
  { name: 'Hel', key: 'hel_half_dead', description: 'While below 50% HP, ATK +30% and DEF +30%.' },
  { name: 'Mimir', key: 'mimir_runic_knowledge', description: 'Every 3rd turn, the next attack deals +90% more damage.' },
  { name: 'Bragi', key: 'bragi_battle_hymn', description: 'ATK +15% for the whole battle.' },
  { name: 'Freyr', key: 'freyr_harvest_bounty', description: 'Restores 6% max HP every 2 turns.' },
  { name: 'Idunn', key: 'idunn_golden_apple', description: 'Once per battle, at 50% HP or below, restore 15% max HP.' },
  { name: 'Magni', key: 'magni_might_of_magni', description: '+5% ATK for every 10% max HP missing, up to +25%.' },
  { name: 'Njord', key: 'njord_seas_favor', description: '15% chance each turn to reduce incoming damage by 30%.' },
  { name: 'Vidar', key: 'vidar_silent_vengeance', description: "When hit by a critical, Vidar's next attack is a guaranteed critical. The first time he drops below 50% HP, his next attack also crits." },

  { name: 'Ares', key: 'ares_blood_frenzy', description: 'At the end of each turn, gain +10% ATK, stacking up to +50%.' },
  { name: 'Hades', key: 'hades_soul_harvest', description: 'While the enemy is below 30% HP, ATK +50% for the rest of the battle.' },
  { name: 'Hera', key: 'hera_divine_wrath', description: 'DEF +30% for the whole battle. When hit by a critical, gain +10% ATK, stacking up to 3 times.' },
  { name: 'Poseidon', key: 'poseidon_tidal_force', description: 'Each attack has a 30% chance to Stun the enemy (skips its next turn) and shred its DEF by 30% for 2 turns. The shred refreshes on each proc but does not stack.' },
  { name: 'Aphrodite', key: 'aphrodite_enchanting_aura', description: '25% chance each turn to Charm the enemy, making it skip its attack.' },
  { name: 'Apollo', key: 'apollo_solar_radiance', description: 'ATK +25% for the whole battle.' },
  { name: 'Artemis', key: 'artemis_huntress_precision', description: 'The first attack each battle always crits; afterward, every 3rd turn the next attack automatically crits.' },
  { name: 'Athena', key: 'athena_aegis_shield', description: 'The first 2 hits taken each battle are reduced by 40%. Afterward, incoming damage is reduced by 10% for the rest of the battle.' },
  { name: 'Hephaestus', key: 'hephaestus_forged_armor', description: 'DEF +25% for the whole battle; while below 50% HP, ATK +20%.' },
  { name: 'Dionysus', key: 'dionysus_drunken_haze', description: '30% chance each turn to make the enemy attack itself for 30% of its own ATK.' },
  { name: 'Nike', key: 'nike_wings_of_victory', description: 'ATK +15% for the whole battle.' },
  { name: 'Persephone', key: 'persephone_cycle_of_renewal', description: 'Once per battle, when HP drops below 50%, restore 15% max HP.' },
]);

const WEAPON_UPDATES = Object.freeze([
  { name: 'Gram', key: 'gram', description: 'Ignores 25% of enemy DEF. Deals +30% bonus damage to enemies above 80% HP.' },
  {
    requestedName: 'Laevateinn',
    name: 'Laevateinn Staff',
    key: 'laevateinn_staff',
    description: 'Attacks ignore 15% of enemy DEF and apply Burn equal to 10% of ATK for 2 turns.',
  },
  { name: 'Spear of Ares', key: 'spear_of_ares', description: 'ATK +10% every turn, stacking up to +40%. Whenever you defeat an enemy, immediately gain a stack.' },
  { name: 'Sword of Damocles', key: 'sword_of_damocles', description: 'ATK +5% every turn, stacking up to +100%. While any stacks are active, you take +10% damage.' },
  { name: 'Tyrfing', key: 'tyrfing', description: 'ATK +10% every turn, stacking up to +30%. Once the enemy drops below 30% HP, the curse takes hold: your attacks can no longer miss or be evaded.' },
]);

const GROUPS = [
  {
    label: 'deity',
    table: 'deity_roster',
    descriptionColumn: 'blessing_description',
    updates: DEITY_UPDATES,
    updateSql: 'UPDATE deity_roster SET blessing_description = $1 WHERE name = $2 RETURNING name',
    verifySql: 'SELECT name, blessing_description AS description FROM deity_roster WHERE name = ANY($1::text[])',
    rosterSql: 'SELECT name FROM deity_roster ORDER BY name',
  },
  {
    label: 'weapon',
    table: 'weapon_roster',
    descriptionColumn: 'passive_description',
    updates: WEAPON_UPDATES,
    updateSql: 'UPDATE weapon_roster SET passive_description = $1 WHERE name = $2 RETURNING name',
    verifySql: 'SELECT name, passive_description AS description FROM weapon_roster WHERE name = ANY($1::text[])',
    rosterSql: 'SELECT name FROM weapon_roster ORDER BY name',
  },
];

function validateDefinitions() {
  if (DEITY_UPDATES.length !== 38 || WEAPON_UPDATES.length !== 5) {
    throw new Error(`Expected 38 deity + 5 weapon definitions; found ${DEITY_UPDATES.length} + ${WEAPON_UPDATES.length}.`);
  }
  for (const group of GROUPS) {
    const names = group.updates.map((entry) => entry.name);
    const keys = group.updates.map((entry) => entry.key);
    if (new Set(names).size !== names.length) throw new Error(`Duplicate ${group.label} target name in update definitions.`);
    if (new Set(keys).size !== keys.length) throw new Error(`Duplicate ${group.label} passive key in update definitions.`);
    if (group.updates.some((entry) => !entry.name || !entry.key || !entry.description)) {
      throw new Error(`Blank ${group.label} name, passive key, or description in update definitions.`);
    }
  }
}

function candidateNames(entry, rosterNames) {
  const requested = String(entry.requestedName || entry.name).toLowerCase();
  const words = requested.split(/\s+/).filter((word) => word.length >= 4);
  return rosterNames.filter((name) => {
    const normalized = name.toLowerCase();
    return normalized.includes(requested) || words.some((word) => normalized.includes(word));
  }).slice(0, 8);
}

async function updateGroup(client, group, rosterNames) {
  const width = String(group.updates.length).length;
  for (let index = 0; index < group.updates.length; index += 1) {
    const entry = group.updates[index];
    const result = await client.query(group.updateSql, [entry.description, entry.name]);
    const sourceLabel = entry.requestedName ? `${entry.requestedName} → ${entry.name}` : entry.name;
    console.log(`[${group.label}] ${String(index + 1).padStart(width, '0')}/${group.updates.length} ${sourceLabel}: ${result.rowCount} row`);
    if (result.rowCount !== 1) {
      const candidates = candidateNames(entry, rosterNames);
      const suffix = candidates.length ? ` Possible stored names: ${candidates.join(', ')}.` : '';
      throw new Error(`${group.table}.${group.descriptionColumn} update for ${sourceLabel} affected ${result.rowCount} rows; expected exactly 1.${suffix}`);
    }
  }
}

async function verifyGroup(client, group) {
  const expected = new Map(group.updates.map((entry) => [entry.name, entry.description]));
  const result = await client.query(group.verifySql, [[...expected.keys()]]);
  const mismatches = [];
  for (const [name, description] of expected) {
    const row = result.rows.find((candidate) => candidate.name === name);
    if (!row) mismatches.push(`${name} (missing)`);
    else if (row.description !== description) mismatches.push(`${name} (description differs)`);
  }
  if (mismatches.length) throw new Error(`${group.label} verification failed: ${mismatches.join(', ')}`);
  console.log(`[verify] ${group.label}: ${result.rows.length}/${group.updates.length} descriptions match exactly`);
}

async function run({ apply = process.argv.includes('--apply') } = {}) {
  validateDefinitions();
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;

    const rosterByGroup = new Map();
    for (const group of GROUPS) {
      const roster = await client.query(group.rosterSql);
      rosterByGroup.set(group.label, roster.rows.map((row) => row.name));
      await updateGroup(client, group, rosterByGroup.get(group.label));
      await verifyGroup(client, group);
    }

    const untouched = {};
    for (const group of GROUPS) {
      const targetNames = new Set(group.updates.map((entry) => entry.name));
      untouched[group.label] = rosterByGroup.get(group.label).filter((name) => !targetNames.has(name));
      console.log(`[unupdated] ${group.label} roster rows (${untouched[group.label].length}): ${untouched[group.label].join(', ') || '(none)'}`);
    }

    if (apply) {
      await client.query('COMMIT');
      inTransaction = false;
      for (const group of GROUPS) await verifyGroup(client, group);
      console.log('[commit] Applied all 43 passive descriptions in one transaction.');
    } else {
      await client.query('ROLLBACK');
      inTransaction = false;
      console.log('[dry-run] All checks passed; transaction rolled back. Re-run with --apply to commit.');
    }
    return { applied: apply, deityRows: DEITY_UPDATES.length, weaponRows: WEAPON_UPDATES.length, untouched };
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`[passive-update] FAILED — transaction rolled back: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { DEITY_UPDATES, WEAPON_UPDATES, run, validateDefinitions };
