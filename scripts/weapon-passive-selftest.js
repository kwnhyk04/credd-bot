'use strict';

/**
 * Exhaustive weapon-passive audit.
 *
 * Every key in the authoritative WEAPON section must be named by one exact contract
 * check below and must also survive a real battle. Bespoke integration checks cover
 * the engine-only timing paths that a registry harness cannot prove by itself.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PASSIVES = require('../src/engine/passiveRegistry');
const { resolveBattle } = require('../src/engine/battleEngine');
const {
  EFFECT_CATEGORY,
  effectCategory,
  isStatusEffect,
  removeEffectsByCategory,
} = require('../src/engine/combatEffects');

const ROOT = path.join(__dirname, '..');
const passiveText = fs.readFileSync(
  path.join(ROOT, 'assets', 'data', 'passive_registry_keys.md'),
  'utf8',
);
const weaponSection = passiveText.slice(
  passiveText.indexOf('## WEAPON'),
  passiveText.indexOf('## ARMOR'),
);
const WEAPON_KEYS = [...weaponSection.matchAll(/^- `([a-z0-9_]+)`/gm)].map((m) => m[1]);
const tested = new Set();

function close(actual, expected, message) {
  assert(Math.abs(actual - expected) < 1e-9, `${message}: got ${actual}, expected ${expected}`);
}

function makeBs(overrides = {}) {
  const attackHooks = [];
  const landedHitHooks = [];
  const enemyDebuffs = [];
  const playerDebuffs = [...(overrides.playerDebuffs || [])];
  const immune = new Set(overrides.enemyImmuneTags || []);
  const bs = {
    currentTurn: 1,
    playerATK: 100,
    playerHP: 100,
    playerMaxHP: 100,
    playerDEF: 50,
    playerCrit: 0,
    enemyATK: 100,
    enemyHP: 100,
    enemyMaxHP: 100,
    enemyDEF: 50,
    playerStatusImmune: false,
    flags: {},
    log: [],
    damageBonusPct: 0,
    bonusIncomingDmgMult: 0,
    playerAtkMult: 0,
    playerDefMult: 0,
    ignoreDefPct: 0,
    nextAttackAutoCrit: false,
    nextAttackDouble: false,
    rng: () => 0,
    enemyDebuffs,
    playerDebuffs,
    enemyImmune: (tag) => immune.has(tag),
    applyDebuff(tag, turns, value = 0) {
      if (immune.has(tag)) return false;
      const existing = enemyDebuffs.find((d) => d.tag === tag);
      if (existing) {
        existing.turns = Math.max(existing.turns, turns);
        existing.value = Math.max(existing.value, value);
      } else {
        enemyDebuffs.push({ tag, turns, value });
      }
      return true;
    },
    applyPlayerDebuff(tag, turns, value = 0) {
      if (bs.playerStatusImmune && isStatusEffect(tag)) return false;
      playerDebuffs.push({ tag, category: effectCategory(tag), turns, value });
      return true;
    },
    hasPlayerDebuff: (tag) => tag === 'any'
      ? playerDebuffs.length > 0
      : playerDebuffs.some((d) => d.tag === tag),
    clearPlayerStatusEffects: () => removeEffectsByCategory(
      playerDebuffs,
      [EFFECT_CATEGORY.STATUS],
    ),
    clearPlayerDebuffs: () => removeEffectsByCategory(
      playerDebuffs,
      [EFFECT_CATEGORY.STATUS, EFFECT_CATEGORY.DOT],
    ),
    onAttack: (fn) => attackHooks.push(fn),
    onLandedHit: (fn) => landedHitHooks.push(fn),
    attackHooks,
    landedHitHooks,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (!['playerDebuffs', 'enemyImmuneTags'].includes(key)) bs[key] = value;
  }
  return bs;
}

function invoke(key, bs) {
  assert.equal(typeof PASSIVES[key], 'function', `missing registry handler: ${key}`);
  PASSIVES[key](bs);
}

function attack(bs) {
  for (const hook of bs.attackHooks) hook();
}

function land(bs, info = {}) {
  for (const hook of bs.landedHitHooks) hook(info);
}

function audit(key, check) {
  assert(!tested.has(key), `duplicate audit contract: ${key}`);
  check();
  tested.add(key);
}

audit('none', () => {
  const bs = makeBs();
  invoke('none', bs);
  assert.equal(bs.log.length, 0);
});

for (const key of ['kampilan', 'bone_crusher', 'carved_totem', 'reinforced_targe']) {
  audit(key, () => {
    const bs = makeBs();
    invoke(key, bs);
    close(bs.playerAtkMult, 0, `${key} waits for an attack`);
    attack(bs);
    close(bs.playerAtkMult, 0.20, `${key} opening bonus`);
    bs.playerAtkMult = 0;
    attack(bs);
    close(bs.playerAtkMult, 0, `${key} is once per battle`);
  });
}

const ATTACK_RIDERS = {
  crystal_wand: [0.10, 0.15],
  recurve_bow: [0.10, 0.20],
  gladius: [0.30, 0.50],
  english_quarterstaff: [0.20, 0.50],
  scythian_composite_bow: [0.20, 0.50],
  kopis: [0.25, 0.60],
  caestus: [0.35, 0.40],
  arrow_of_eros: [0.30, 0.45],
  freyrs_arrow: [0.50, 1.00],
};
for (const [key, [chance, bonus]] of Object.entries(ATTACK_RIDERS)) {
  audit(key, () => {
    const proc = makeBs({ rng: () => 0 });
    invoke(key, proc);
    close(proc.playerAtkMult, 0, `${key} has no passive-phase damage`);
    attack(proc);
    close(proc.playerAtkMult, bonus, `${key} proc bonus`);
    const boundary = makeBs({ rng: () => chance });
    invoke(key, boundary);
    attack(boundary);
    close(boundary.playerAtkMult, 0, `${key} exact boundary does not proc`);
  });
}

const LANDED_DEBUFFS = {
  cutlass: [0.10, 'bleed', 2, 5],
  war_club: [0.10, 'stun', 1, 0],
  // On-hit stat shreds use two internal ticks so one effective turn remains after
  // the engine's end-of-proc-round decrement.
  pilgrims_bordone: [0.50, 'def_down', 2, 0.15],
  galdrastafir: [0.50, 'def_down', 2, 0.30],
};
for (const [key, [chance, tag, turns, value]] of Object.entries(LANDED_DEBUFFS)) {
  audit(key, () => {
    const bs = makeBs({ rng: () => 0 });
    invoke(key, bs);
    attack(bs);
    assert.equal(bs.enemyDebuffs.length, 0, `${key} cannot proc before a landed hit`);
    land(bs);
    assert.deepEqual(bs.enemyDebuffs[0], { tag, turns, value });
    const boundary = makeBs({ rng: () => chance });
    invoke(key, boundary);
    attack(boundary);
    land(boundary);
    assert.equal(boundary.enemyDebuffs.length, 0, `${key} exact boundary does not proc`);
  });
}

const STACKING_ATK = {
  scimitar: [0.03, 0.15, 1],
  bagh_nakh: [0.05, 0.25, 1],
  holmegaard_bow: [0.03, 0.15, 1],
  xiphos: [0.04, 0.20, 1],
  dory: [0.06, 0.18, 2],
  cretan_bow: [0.04, 0.20, 1],
  spear_of_ares: [0.10, 0.40, 1],
};
for (const [key, [, cap]] of Object.entries(STACKING_ATK)) {
  audit(key, () => {
    const bs = makeBs();
    for (let turn = 1; turn <= 20; turn += 1) {
      bs.currentTurn = turn;
      bs.playerAtkMult = 0;
      invoke(key, bs);
    }
    close(bs.playerAtkMult, cap, `${key} stack cap`);
  });
}

const STATE_BONUSES = {
  roman_cestus: ['enemy_is_stunned', 0.50],
  myrmex: ['enemy_is_stunned', 0.40],
  juru_pakal: ['enemy_is_bleeding', 0.50],
};
for (const [key, [flag, bonus]] of Object.entries(STATE_BONUSES)) {
  audit(key, () => {
    const bs = makeBs();
    bs.flags[flag] = true;
    invoke(key, bs);
    attack(bs);
    close(bs.playerAtkMult, bonus, `${key} conditional bonus`);
  });
}

const DEFENSIVE_CHANCES = {
  steel_kite_shield: [0.10, 'steel_kite_shield_block'],
  enderby_shield: [0.10, 'enderby_reflect_check'],
  pelte: [0.15, 'pelte_block_check'],
  gridr_iron_gloves: [0.20, 'gridr_ignore_check'],
  skjaldmaer: [0.15, 'skjaldmaer_ignore_check'],
};
for (const [key, [chance, flag]] of Object.entries(DEFENSIVE_CHANCES)) {
  audit(key, () => {
    const proc = makeBs({ rng: () => 0 });
    invoke(key, proc);
    assert.equal(proc.flags[flag], true, `${key} proc flag`);
    const boundary = makeBs({ rng: () => chance });
    invoke(key, boundary);
    assert.equal(boundary.flags[flag], false, `${key} exact boundary does not proc`);
    if (key === 'pelte') close(proc.flags.pelte_block_pct, 0.25, 'Pelte block amount');
  });
}

audit('crossbow', () => {
  const bs = makeBs();
  invoke('crossbow', bs);
  attack(bs);
  close(bs.playerAtkMult, 0.20, 'Crossbow opening bonus');
  assert.equal(bs.flags.crossbow_pierce, true);
  bs.playerAtkMult = 0;
  attack(bs);
  close(bs.playerAtkMult, 0, 'Crossbow opener is one-shot');
});

audit('katana', () => {
  const bs = makeBs();
  invoke('katana', bs);
  assert.equal(bs.damageBonusPct, 30);
});

audit('pata', () => {
  const bs = makeBs();
  invoke('pata', bs);
  assert.equal(bs.enemyDebuffs.length, 0);
  land(bs);
  assert.deepEqual(bs.enemyDebuffs[0], { tag: 'bleed', turns: 2, value: 5 });
});

audit('japanese_bo', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('japanese_bo', bs);
  attack(bs);
  assert.equal(bs.flags.japanese_bo_active, true);
  const boundary = makeBs({ rng: () => 0.25 });
  invoke('japanese_bo', boundary);
  attack(boundary);
  assert.equal(boundary.flags.japanese_bo_active, false);
});

audit('egyptian_asa', () => {
  const bs = makeBs();
  for (let turn = 1; turn <= 8; turn += 1) {
    bs.ignoreDefPct = 0;
    invoke('egyptian_asa', bs);
  }
  close(bs.ignoreDefPct, 0.15, 'Egyptian Asa pierce cap');
});

audit('vatican_aspis', () => {
  const bs = makeBs();
  invoke('vatican_aspis', bs);
  close(bs.playerAtkMult, 0.10, 'Vatican ATK');
  close(bs.bonusIncomingDmgMult, -0.10, 'Vatican reduction');
});

for (const [key, rounds, amount] of [
  ['battersea_shield', 2, 0.25],
  ['dipylon_shield', 3, 0.20],
]) {
  audit(key, () => {
    const active = makeBs({ currentTurn: rounds });
    invoke(key, active);
    close(active.playerDefMult, amount, `${key} active window`);
    const expired = makeBs({ currentTurn: rounds + 1 });
    invoke(key, expired);
    close(expired.playerDefMult, 0, `${key} expires`);
  });
}

audit('scandinavian_glacial_wooden_bow', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('scandinavian_glacial_wooden_bow', bs);
  assert.equal(bs.flags.extra_turn, undefined);
  attack(bs);
  assert.equal(bs.flags.extra_turn, true);
  const boundary = makeBs({ rng: () => 0.10 });
  invoke('scandinavian_glacial_wooden_bow', boundary);
  attack(boundary);
  assert.equal(boundary.flags.extra_turn, false);
});

audit('thyrsus', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('thyrsus', bs);
  assert.deepEqual(bs.enemyDebuffs[0], { tag: 'bleed', turns: 2, value: 5 });
  const boundary = makeBs({ rng: () => 0.20 });
  invoke('thyrsus', boundary);
  assert.equal(boundary.enemyDebuffs.length, 0);
});

audit('gram', () => {
  const bs = makeBs({ enemyHP: 81, enemyMaxHP: 100 });
  invoke('gram', bs);
  close(bs.ignoreDefPct, 0.25, 'Gram pierce');
  attack(bs);
  close(bs.playerAtkMult, 0.30, 'Gram healthy-target bonus');
});

audit('tyrfing', () => {
  const bs = makeBs({ enemyHP: 29, enemyMaxHP: 100 });
  invoke('tyrfing', bs);
  close(bs.playerAtkMult, 0.10, 'Tyrfing first stack');
  assert.equal(bs.flags.tyrfing_no_miss, true);
  bs.playerAtkMult = 0;
  invoke('tyrfing', bs);
  close(bs.playerAtkMult, 0.20, 'Tyrfing second stack');
});

audit('laevateinn_sword', () => {
  const bs = makeBs();
  for (let i = 0; i < 4; i += 1) invoke('laevateinn_sword', bs);
  close(bs.flags.laevateinn_sword_def_stack, 0.30, 'Laevateinn Sword cap');
  const immune = makeBs({ enemyImmuneTags: ['def_down'] });
  invoke('laevateinn_sword', immune);
  close(immune.flags.laevateinn_sword_def_stack, 0, 'Laevateinn immunity');
});

audit('jarngreipr', () => {
  const bs = makeBs();
  invoke('jarngreipr', bs);
  assert.equal(bs.flags.jarngreipr_on_stun, true);
  close(bs.playerAtkMult, 0, 'Jarngreipr waits for a successful stun');
});

audit('alans_reversed_hands', () => {
  const bs = makeBs({ playerDebuffs: [
    { tag: 'stun', category: EFFECT_CATEGORY.STATUS },
    { tag: 'burn', category: EFFECT_CATEGORY.DOT },
  ] });
  invoke('alans_reversed_hands', bs);
  assert.equal(bs.playerStatusImmune, true);
  assert.deepEqual(bs.playerDebuffs.map((d) => d.tag), ['burn']);
});

audit('knuckle_charm_anting_anting', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('knuckle_charm_anting_anting', bs);
  attack(bs);
  assert.equal(bs.flags.instakill_check, undefined);
  land(bs);
  assert.equal(bs.flags.instakill_check, true);
  const boundary = makeBs({ rng: () => 0.05 });
  invoke('knuckle_charm_anting_anting', boundary);
  attack(boundary);
  land(boundary);
  assert.equal(boundary.flags.instakill_check, false);
});

audit('laevateinn_staff', () => {
  const bs = makeBs();
  invoke('laevateinn_staff', bs);
  close(bs.ignoreDefPct, 0.15, 'Laevateinn Staff pierce');
  assert.equal(bs.flags.laevateinn_staff_on_hit, true);
});

audit('babaylans_ritual_staff', () => {
  const bs = makeBs({
    playerDebuffs: [
      { tag: 'stun', category: EFFECT_CATEGORY.STATUS },
      { tag: 'burn', category: EFFECT_CATEGORY.DOT },
    ],
    flags: { positive_buff: true },
    rng: () => 0.49,
  });
  invoke('babaylans_ritual_staff', bs);
  assert.equal(bs.playerDebuffs.length, 0);
  close(bs.playerAtkMult, 1, 'Babaylan non-empty cleanse bonus');
  assert.equal(bs.flags.positive_buff, true);
  const clean = makeBs({ rng: () => 0.49 });
  invoke('babaylans_ritual_staff', clean);
  close(clean.playerAtkMult, 0, 'Babaylan empty cleanse');
  const failedRoll = makeBs({
    playerDebuffs: [{ tag: 'burn', category: EFFECT_CATEGORY.DOT }],
    rng: () => 0.50,
  });
  invoke('babaylans_ritual_staff', failedRoll);
  assert.equal(failedRoll.playerDebuffs.length, 1);
  close(failedRoll.playerAtkMult, 0, 'Babaylan exact boundary does not cleanse');
});

audit('badiang_stalk', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('badiang_stalk', bs);
  attack(bs);
  assert.equal(bs.flags.rupture_check, undefined);
  land(bs);
  assert.equal(bs.flags.rupture_check, true);
  close(bs.flags.rupture_pct, 0.10, 'Badiang rupture amount');
  const boundary = makeBs({ rng: () => 0.30 });
  invoke('badiang_stalk', boundary);
  attack(boundary);
  land(boundary);
  assert.equal(boundary.flags.rupture_check, false);
});

audit('shield_of_the_valkyrie', () => {
  const bs = makeBs();
  bs.flags.valkyrie_shield_def = 0.10;
  bs.flags.valkyrie_shield_atk = 0.10;
  invoke('shield_of_the_valkyrie', bs);
  assert.equal(bs.flags.valkyrie_resolve_active, true);
  close(bs.playerAtkMult, 0.10, 'Valkyrie persistent ATK stacks');
  close(bs.playerDefMult, 0.10, 'Valkyrie persistent DEF stacks');
});

audit('luzon_tribal_shield', () => {
  const bs = makeBs({ playerDebuffs: [{ tag: 'burn' }] });
  invoke('luzon_tribal_shield', bs);
  close(bs.playerDefMult, 0.40, 'Luzon debuffed DEF');
});

audit('gusisnautar', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('gusisnautar', bs);
  attack(bs);
  land(bs);
  assert.equal(bs.flags.hemorrhage_check, true);
  close(bs.flags.hemorrhage_pct, 0.10, 'Gusisnautar hemorrhage amount');
  assert.deepEqual(bs.enemyDebuffs[0], { tag: 'def_down', turns: 2, value: 0.15 });
  const boundary = makeBs({ rng: () => 0.50 });
  invoke('gusisnautar', boundary);
  attack(boundary);
  land(boundary);
  assert.equal(boundary.flags.hemorrhage_check, false);
});

audit('harpe', () => {
  const bs = makeBs();
  invoke('harpe', bs);
  close(bs.ignoreDefPct, 0.30, 'Harpe pierce');
});

audit('sword_of_damocles', () => {
  const bs = makeBs();
  for (let i = 0; i < 25; i += 1) {
    bs.playerAtkMult = 0;
    bs.bonusIncomingDmgMult = 0;
    invoke('sword_of_damocles', bs);
  }
  close(bs.playerAtkMult, 1, 'Damocles ATK cap');
  close(bs.bonusIncomingDmgMult, 0.10, 'Damocles incoming penalty');
});

audit('labrys', () => {
  const bs = makeBs({ currentTurn: 3 });
  invoke('labrys', bs);
  assert.equal(bs.flags.labrys_double_hit, undefined);
  attack(bs);
  assert.equal(bs.flags.labrys_double_hit, true);
  close(bs.flags.labrys_second_hit_pct, 0.70, 'Labrys second hit');
});

audit('hephaestus_hammer', () => {
  const bs = makeBs({ currentTurn: 4 });
  invoke('hephaestus_hammer', bs);
  close(bs.playerDefMult, 0.20, 'Hammer permanent DEF');
  attack(bs);
  close(bs.playerAtkMult, 1.50, 'Hammer forge strike');
});

audit('caduceus', () => {
  const bs = makeBs({ currentTurn: 3, playerHP: 50, playerDebuffs: [{ tag: 'burn' }] });
  invoke('caduceus', bs);
  assert.equal(bs.playerDebuffs.length, 0);
  assert.equal(bs.playerHP, 58);
});

audit('helm_of_darkness', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('helm_of_darkness', bs);
  assert.deepEqual(bs.enemyDebuffs[0], { tag: 'def_down', turns: 2, value: 0.50 });
  const boundary = makeBs({ rng: () => 0.30 });
  invoke('helm_of_darkness', boundary);
  assert.equal(boundary.enemyDebuffs.length, 0);
});

audit('aegis', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('aegis', bs);
  attack(bs);
  assert.equal(bs.flags.aegis_stacks, 0);
  land(bs); land(bs); land(bs);
  assert.equal(bs.flags.aegis_stacks, 0);
  assert(bs.enemyDebuffs.some((d) => d.tag === 'stun'));
  const boundary = makeBs({ rng: () => 0.50 });
  invoke('aegis', boundary);
  land(boundary);
  assert.equal(boundary.flags.aegis_stacks, 0);
});

audit('apollos_silver_bow', () => {
  const bs = makeBs({ currentTurn: 4 });
  invoke('apollos_silver_bow', bs);
  close(bs.ignoreDefPct, 0.25, 'Apollo bow pierce');
  assert.equal(bs.nextAttackAutoCrit, false);
  attack(bs);
  assert.equal(bs.nextAttackAutoCrit, true);
});

audit('mjolnir', () => {
  const normal = makeBs({ currentTurn: 1 });
  invoke('mjolnir', normal);
  attack(normal);
  close(normal.playerAtkMult, 0.30, 'Mjolnir normal turn');
  const crush = makeBs({ currentTurn: 3 });
  invoke('mjolnir', crush);
  attack(crush);
  close(crush.playerAtkMult, 2.30, 'Mjolnir third-turn crush');
});

audit('gungnir', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('gungnir', bs);
  close(bs.ignoreDefPct, 0.40, 'Gungnir base pierce');
  assert.equal(bs.flags.gungnir_full_pierce, undefined);
  attack(bs);
  assert.equal(bs.flags.gungnir_full_pierce, true);
  const boundary = makeBs({ rng: () => 0.25 });
  invoke('gungnir', boundary);
  attack(boundary);
  assert.equal(boundary.flags.gungnir_full_pierce, false);
});

audit('thunderbolt_of_zeus', () => {
  const bs = makeBs();
  invoke('thunderbolt_of_zeus', bs);
  assert.equal(bs.flags.thunderbolt_on_crit, true);
  close(bs.playerAtkMult, 0, 'Thunderbolt waits for the final crit result');
});

audit('trident_of_poseidon', () => {
  const bs = makeBs({ currentTurn: 2, rng: () => 0 });
  invoke('trident_of_poseidon', bs);
  attack(bs);
  close(bs.playerAtkMult, 1, 'Trident even-turn attack bonus');
  assert.equal(bs.enemyDebuffs.length, 0);
  land(bs);
  assert(bs.enemyDebuffs.some((d) => d.tag === 'stun'));
  assert(bs.enemyDebuffs.some((d) => d.tag === 'def_down' && d.turns === 2 && d.value === 0.20));
  const boundary = makeBs({ currentTurn: 2, rng: () => 0.30 });
  invoke('trident_of_poseidon', boundary);
  attack(boundary);
  land(boundary);
  assert(!boundary.enemyDebuffs.some((d) => d.tag === 'stun'));
  assert(boundary.enemyDebuffs.some((d) => d.tag === 'def_down'));
});

assert.deepEqual(
  [...tested].sort(),
  [...WEAPON_KEYS].sort(),
  'every authoritative weapon key must have one explicit audit contract',
);

function player(over = {}) {
  return {
    name: 'Hero', kind: 'player', class: 'Test', classPassive: null,
    atk: 100, hp: 100000, def: 0, crit: 0, bonusDmgPct: 0,
    weaponPassiveKey: 'none', armorPassiveKey: 'none', deityBlessingKey: 'none',
    ...over,
  };
}

function mob(over = {}) {
  return {
    name: 'Dummy', kind: 'mob', mobType: 'regular', atk: 0, hp: 100000,
    def: 0, crit: 0, skillKey: 'none', immunityTags: [], specialFlags: {},
    ...over,
  };
}

const events = (sim) => sim.rounds.flatMap((round) => round.events);
const roundEvents = (sim, round) => sim.rounds.find((r) => r.round === round)?.events || [];
const has = (list, token) => list.some((event) => event.includes(token));
const firstAttackDamage = (sim) => {
  const line = events(sim).find((event) => event.includes('Hero attacks for **'));
  return Number(/\*\*(\d+) DMG\*\*/.exec(line || '')?.[1] || 0);
};
const attackDamageOnRound = (sim, round) => {
  const line = roundEvents(sim, round).find((event) => event.includes('Hero attacks for **'));
  return Number(/\*\*(\d+) DMG\*\*/.exec(line || '')?.[1] || 0);
};

// Laevateinn's durable shred must affect player DEF in duels, not only mob DEF.
{
  const baseline = resolveBattle(
    player(),
    player({ name: 'Rival', atk: 0, def: 200 }),
    { mode: 'duel', rng: () => 0.5 },
  );
  const sword = resolveBattle(
    player({ weaponPassiveKey: 'laevateinn_sword' }),
    player({ name: 'Rival', atk: 0, def: 200 }),
    { mode: 'duel', rng: () => 0.5 },
  );
  assert(firstAttackDamage(sword) > firstAttackDamage(baseline), 'Laevateinn Sword must shred duel DEF');
}

// Alan's full status immunity is active before either duelist's round-1 passive,
// including when Alan acts second and would otherwise lose the passive-order race.
{
  const defender = { name: 'Alan', atk: 0, def: 200, weaponPassiveKey: 'alans_reversed_hands' };
  const baseline = resolveBattle(
    player(),
    player(defender),
    { mode: 'duel', rng: () => 0 },
  );
  const sword = resolveBattle(
    player({ weaponPassiveKey: 'laevateinn_sword' }),
    player(defender),
    { mode: 'duel', rng: () => 0 },
  );
  assert.equal(firstAttackDamage(sword), firstAttackDamage(baseline));
  assert(!has(events(sword), 'Laevateinn Sword: Sundering Flame'));
}

// A proc pre-roll is harmless when the actual hit is evaded: no on-hit debuff/log.
{
  const sim = resolveBattle(
    player({ weaponPassiveKey: 'cutlass' }),
    player({ name: 'Amihan', deityBlessingKey: 'amihan_tailwind' }),
    { mode: 'duel', rng: () => 0 },
  );
  assert(has(events(sim), 'evades the attack (Tailwind)'));
  assert(!has(events(sim), 'Cutlass: Serrated Edge'));
}

// Static defensive armor is established before either duelist's passive phase, so
// acting first cannot let a turn-bound weapon debuff bypass Salakot Ward.
{
  const rolls = [0, 0.99, 0.99, 0, 0];
  const sim = resolveBattle(
    player({ weaponPassiveKey: 'helm_of_darkness' }),
    player({ name: 'Warded', atk: 0, armorPassiveKey: 'salakot_ward' }),
    { mode: 'duel', rng: () => rolls.shift() ?? 0.5 },
  );
  assert(has(roundEvents(sim, 1), 'negates an incoming DEF Down'));
  assert(!has(roundEvents(sim, 1), 'Helm of Darkness: Invisibility'));

  const swordRolls = [0, 0.99, 0.99, 0];
  const sword = resolveBattle(
    player({ weaponPassiveKey: 'laevateinn_sword' }),
    player({ name: 'Warded', atk: 0, armorPassiveKey: 'salakot_ward' }),
    { mode: 'duel', rng: () => swordRolls.shift() ?? 0.5 },
  );
  assert(has(roundEvents(sword, 1), 'negates an incoming DEF Down'));
  assert(!has(roundEvents(sword, 1), 'Laevateinn Sword: Sundering Flame'));
}

// Two landed sub-hits immediately grant two distinct Valkyrie Resolve stacks.
{
  const sim = resolveBattle(
    player({ weaponPassiveKey: 'shield_of_the_valkyrie', atk: 1 }),
    mob({ atk: 10, specialFlags: { multi_attack: 2, multi_attack_pct: 1 } }),
    { rng: () => 0.9 },
  );
  assert(has(roundEvents(sim, 1), 'DEF +10%, ATK +10%'));
}

// Japanese Bo heals from the finishing hit, not only non-lethal hits.
{
  const rolls = [0.9, 0.99, 0.99, 0.5, 0, 0.5];
  const sim = resolveBattle(
    player({ weaponPassiveKey: 'japanese_bo', atk: 1000, hp: 2000 }),
    mob({ atk: 1000, hp: 100 }),
    { rng: () => rolls.shift() ?? 0.5 },
  );
  assert.equal(sim.winner, 'a');
  assert.equal(sim.a.hp, 1500, 'Japanese Bo should heal 500 from the lethal hit');
  assert(has(events(sim), 'Japanese Bo: Vital Siphon — Recovered 500 HP'));
}

// Lifesteal cannot revive an attacker that died to reflection from the same hit.
{
  const rolls = [0, 0.99, 0.99, 0, 0, 0.5];
  const sim = resolveBattle(
    player({ weaponPassiveKey: 'japanese_bo', atk: 1000, hp: 100 }),
    player({ name: 'Reflector', weaponPassiveKey: 'enderby_shield', atk: 0, hp: 10000 }),
    { mode: 'duel', rng: () => rolls.shift() ?? 0.5 },
  );
  assert.equal(sim.winner, 'b');
  assert.equal(sim.a.hp, 0, 'lethal reflection must leave the attacker defeated');
  assert(!has(events(sim), 'Japanese Bo: Vital Siphon'));
}

// A DEF shred applied after a hit remains for the next attack instead of expiring
// unused at the end of its proc round.
{
  const sim = resolveBattle(
    player({ weaponPassiveKey: 'pilgrims_bordone', atk: 100 }),
    mob({ hp: 100000, def: 200 }),
    { rng: () => 0 },
  );
  assert(
    attackDamageOnRound(sim, 2) > attackDamageOnRound(sim, 1),
    "Pilgrim's Bordone shred must increase the next round's damage",
  );
}

// Guaranteed crits count as real crits for Thunderbolt; evaded crits do not.
{
  const proc = resolveBattle(
    player({ weaponPassiveKey: 'thunderbolt_of_zeus', deityBlessingKey: 'artemis_huntress_precision' }),
    mob(),
    { rng: () => 0.99 },
  );
  assert(has(roundEvents(proc, 1), 'Thunderbolt of Zeus: Divine Thunder'));
  const evaded = resolveBattle(
    player({ weaponPassiveKey: 'thunderbolt_of_zeus', crit: 100 }),
    player({ name: 'Amihan', deityBlessingKey: 'amihan_tailwind' }),
    { mode: 'duel', rng: () => 0 },
  );
  assert(has(events(evaded), 'evades the attack (Tailwind)'));
  assert(!has(events(evaded), 'Thunderbolt of Zeus: Divine Thunder'));
}

// Jarngreipr checks final immunity state, then activates only on a successful stun.
{
  const immune = resolveBattle(
    player({ class: 'Fighter', classPassive: 'stun', weaponPassiveKey: 'jarngreipr' }),
    player({ name: 'Alan', weaponPassiveKey: 'alans_reversed_hands' }),
    { mode: 'duel', rng: () => 0 },
  );
  assert(!has(events(immune), 'Jarngreipr: Thunder Grip'));
  const success = resolveBattle(
    player({ class: 'Fighter', classPassive: 'stun', weaponPassiveKey: 'jarngreipr' }),
    mob(),
    { rng: () => 0 },
  );
  assert(has(events(success), 'Jarngreipr: Thunder Grip'));
  const armoredTarget = { name: 'Warded', atk: 0, armorPassiveKey: 'anting_anting_sash' };
  const armoredBaseline = resolveBattle(
    player({ class: 'Fighter', classPassive: 'stun' }),
    player(armoredTarget),
    { mode: 'duel', rng: () => 0 },
  );
  const armoredJarngreipr = resolveBattle(
    player({ class: 'Fighter', classPassive: 'stun', weaponPassiveKey: 'jarngreipr' }),
    player(armoredTarget),
    { mode: 'duel', rng: () => 0 },
  );
  assert.equal(firstAttackDamage(armoredJarngreipr), firstAttackDamage(armoredBaseline));
  assert(!has(events(armoredJarngreipr), 'Jarngreipr: Thunder Grip'));

  const fightWard = (weaponPassiveKey) => {
    const rolls = [0, 0.99, 0, 0.99, 0.5, 0];
    return resolveBattle(
      player({ class: 'Fighter', classPassive: 'stun', weaponPassiveKey }),
      player({ name: 'Warded', atk: 0, armorPassiveKey: 'salakot_ward' }),
      { mode: 'duel', rng: () => rolls.shift() ?? 0.5 },
    );
  };
  const wardedBaseline = fightWard('none');
  const wardedJarngreipr = fightWard('jarngreipr');
  assert(has(events(wardedJarngreipr), 'negates an incoming Stun'));
  assert.equal(firstAttackDamage(wardedJarngreipr), firstAttackDamage(wardedBaseline));
  assert(!has(events(wardedJarngreipr), 'Jarngreipr: Thunder Grip'));
}

// A periodic attack hook registered on a CC-skipped turn neither logs nor carries.
{
  const sim = resolveBattle(
    player({ weaponPassiveKey: 'apollos_silver_bow', crit: 0, atk: 1 }),
    mob({ skillKey: 'stone_stare' }),
    { rng: () => 0.99 },
  );
  assert(has(roundEvents(sim, 4), 'unable to act'));
  assert(!has(roundEvents(sim, 4), "Apollo's Silver Bow: Unerring Arrow"));
  assert(!has(roundEvents(sim, 5), '(CRIT!)'));
}

// Finally, every catalogued key must complete a real deterministic battle safely.
for (const key of WEAPON_KEYS) {
  const sim = resolveBattle(
    player({ weaponPassiveKey: key }),
    mob({ hp: 1000, atk: 10 }),
    { seed: 17 },
  );
  assert(['a', 'b'].includes(sim.winner), `${key}: invalid winner`);
  assert(Number.isFinite(sim.a.hp) && Number.isFinite(sim.b.hp), `${key}: non-finite HP`);
}

console.log(`WEAPON PASSIVE SELFTEST: ${WEAPON_KEYS.length - 1} passives + none audited; all checks passed`);
