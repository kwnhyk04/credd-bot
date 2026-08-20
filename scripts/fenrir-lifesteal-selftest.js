'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { resolveBattle } = require(path.join(ROOT, 'src', 'engine', 'battleEngine'));
const {
  FENRIR_PASSIVE_KEY,
  fenrirPhaseForHp,
  reconcileFenrirPhase,
} = require(path.join(ROOT, 'src', 'engine', 'passiveRegistry'));
const {
  RUNE_VALUE_RANGES,
  rollRuneValue,
  runeDescription,
} = require(path.join(ROOT, 'src', 'config', 'runes'));
const {
  bossMaxHpForChest,
  bossChestForSpawn,
} = require(path.join(ROOT, 'src', 'config', 'bosses'));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`), failed += 1;
}

function player(over = {}) {
  return Object.assign({
    name: 'Hero', kind: 'player', class: 'Test', classPassive: null,
    level: 50, atk: 3000, hp: 100000, def: 1000, crit: 0,
    bonusDmgPct: 0, weaponPassiveKey: 'none', weaponName: 'Test Blade',
    armorPassiveKey: 'none', deityBlessingKey: 'none', deityName: null,
    echoBlessingKey: 'none', effectRunes: [],
  }, over);
}

function boss(over = {}) {
  return Object.assign({
    name: 'Fenrir', kind: 'mob', mobType: 'boss', atk: 1000,
    hp: 10000, def: 0, crit: 0, skillKey: FENRIR_PASSIVE_KEY,
    skillName: "Gleipnir's Doom", skillDescription: 'test',
    immunityTags: [], specialFlags: {}, poolHp: 10000, poolMaxHp: 10000,
  }, over);
}

function events(sim) {
  return sim.rounds.flatMap((round) => round.events);
}

function firstEventContaining(sim, text) {
  return events(sim).find((event) => event.includes(text)) || '';
}

const fenrirMigration = fs.readFileSync(
  path.join(ROOT, 'scripts', 'migrations', '20260805_00_fenrir_lifesteal_balance.sql'),
  'utf8',
);
const passiveKeys = fs.readFileSync(
  path.join(ROOT, 'assets', 'data', 'passive_registry_keys.md'),
  'utf8',
);

check('Fenrir passive key is registered in the passive ledger',
  passiveKeys.includes(`\`${FENRIR_PASSIVE_KEY}\``));
check('Fenrir migration sets the exact passive identity',
  fenrirMigration.includes("skill_key = expected_skill_key")
    && fenrirMigration.includes("expected_skill_key CONSTANT TEXT := 'fenrir_gleipnirs_doom'"));
check('Fenrir migration clears old immunity state',
  fenrirMigration.includes("immunity_tags = '[]'::jsonb")
    && fenrirMigration.includes("- 'stun_resistance' - 'stun_immune'"));

const phases = [
  [760, 0, 1.00, 0.00],
  [750, 1, 1.10, 0.05],
  [500, 2, 1.20, 0.10],
  [250, 3, 1.35, 0.15],
];
for (const [hp, index, damageMultiplier, armorPenetration] of phases) {
  const phase = fenrirPhaseForHp(hp, 1000);
  check(`Fenrir phase boundary ${hp / 10}%`,
    phase.index === index
      && phase.outgoingDamageMultiplier === damageMultiplier
      && phase.armorPenetration === armorPenetration);
}
const first = reconcileFenrirPhase({}, 600, 1000);
const healed = reconcileFenrirPhase(first.state, 900, 1000);
const final = reconcileFenrirPhase(healed.state, 200, 1000);
check('Fenrir phase bonuses are total, not cumulative',
  first.phase.outgoingDamageMultiplier === 1.10
    && final.phase.outgoingDamageMultiplier === 1.35
    && final.phase.armorPenetration === 0.15);
check('Fenrir phase cannot weaken after healing',
  healed.phase.index === 1 && !healed.advanced && final.phase.index === 3);

const crossing = resolveBattle(
  player({ atk: 100000 }),
  boss(),
  { mode: 'boss', rng: () => 0.5 },
);
const crossingEvents = events(crossing).filter((event) => event.includes('Gleipnir'));
check('large Fenrir hit activates only the highest crossed phase',
  crossingEvents.length === 1 && crossingEvents[0].includes('RAGNARÖK UNBOUND'));
check('Fenrir has no previous bleed or stun passive in combat',
  !events(crossing).some((event) => /Fenrir.*(Bleed|Stun)|Fenrir.*resist/i.test(event)));

const fenrirDamage = resolveBattle(
  player(),
  boss(),
  { mode: 'boss', rng: () => 0.5 },
);
const ordinaryDamage = resolveBattle(
  player(),
  boss({ skillKey: 'none', skillName: null, skillDescription: null }),
  { mode: 'boss', rng: () => 0.5 },
);
const fenrirStrike = firstEventContaining(fenrirDamage, 'Fenrir strikes');
const ordinaryStrike = firstEventContaining(ordinaryDamage, 'Fenrir strikes');
const damageValue = (line) => Number(/\*\*(\d+) DMG\*\*/.exec(line)?.[1] || 0);
check('Fenrir phase bonus increases outgoing damage through mob damage calculation',
  damageValue(fenrirStrike) > damageValue(ordinaryStrike));
check('Fenrir armor penetration is applied through effective DEF',
  damageValue(fenrirStrike) === 191 && damageValue(ordinaryStrike) === 166);
check('other bosses do not receive Fenrir phase state',
  ordinaryDamage.b.bossPassiveState?.fenrirPhaseIndex == null
    && !events(ordinaryDamage).some((event) => event.includes('Gleipnir')));

const runeTargets = { Mythic: [10, 15], Legendary: [20, 35], Supreme: [40, 50] };
for (const [tier, [min, max]] of Object.entries(runeTargets)) {
  check(`${tier} Lifesteal range matches target`,
    JSON.stringify(RUNE_VALUE_RANGES.vampiric[tier]) === JSON.stringify([min, max])
      && rollRuneValue('vampiric', tier, () => 0) === min
      && rollRuneValue('vampiric', tier, () => 0.999999999) === max);
}
check('other rune ranges are unchanged',
  JSON.stringify(RUNE_VALUE_RANGES.sharpness) === JSON.stringify({
    Rare: [1, 3], Mythic: [4, 7], Legendary: [8, 12], Supreme: [15, 20],
  }));
check('Lifesteal glossary uses the new Mythic range',
  runeDescription('vampiric', null, '', 'Mythic') === 'Lifesteal 10-15% of damage dealt');

const lifesteal = resolveBattle(
  player({ effectRunes: [{ effect_key: 'vampiric', value: 50 }] }),
  boss({ name: 'Practice Boss', skillKey: 'none', skillName: null, skillDescription: null, atk: 10000, hp: 100000 }),
  { mode: 'boss', rng: () => 0.5 },
);
check('50% Lifesteal is interpreted as 0.50 healing, not a 50x multiplier',
  firstEventContaining(lifesteal, 'Vampiric Rune — healed 1,500 HP.') !== ''
    && lifesteal.a.hp <= lifesteal.a.maxHp
    && lifesteal.snapshots.every((snapshot) => snapshot.a.hp <= snapshot.a.maxHp));

check('Lifesteal migration targets only owned vampiric runes',
  fenrirMigration.includes('public.user_runes')
    && fenrirMigration.includes("rn.effect_key = 'vampiric'")
    && fenrirMigration.includes("rn.tier IN ('Mythic', 'Legendary', 'Supreme')"));
check('Lifesteal migration is idempotent and rollback-capable',
  fenrirMigration.includes('ON CONFLICT (rune_uid) DO NOTHING')
    && fenrirMigration.includes('IS DISTINCT FROM')
    && fenrirMigration.includes('credd_lifesteal_rune_balance_backup_20260805'));
check('Lifesteal audit table survives hosted SQL-editor autocommit boundaries',
  fenrirMigration.includes('DROP TABLE IF EXISTS _lifesteal_rune_balance_audit')
    && fenrirMigration.includes('CREATE TEMP TABLE _lifesteal_rune_balance_audit AS')
    && !fenrirMigration.includes('ON COMMIT DROP'));
check('Calamity golden-looking chest never changes the direct DB HP value',
  bossMaxHpForChest(100000, 0, null, bossChestForSpawn('Fenrir', 'natural'), 'Fenrir') === 100000
    && bossMaxHpForChest(100000, 0, null, bossChestForSpawn('Bakunawa', 'dev'), 'Bakunawa') === 100000);

console.log(JSON.stringify({ passed, failed, failures }));
if (failed > 0) process.exit(1);
