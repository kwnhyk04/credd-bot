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
const { weaponEntry } = require('../src/commands/rpg/compare');
const {
  GENESIS_STATS,
  SUPREME_STATS,
  rollWeaponStats,
  effectiveWeaponBonusDmgPct,
} = require('../src/config/dropRates');
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
const armorSection = passiveText.slice(
  passiveText.indexOf('## ARMOR'),
  passiveText.indexOf('## DEITY'),
);
const NEW_ARMOR_KEYS = [...armorSection.matchAll(/^- `([a-z0-9_]+)`/gm)].map((m) => m[1]);
const MIGRATED_ARMOR_KEYS = [
  'steel_kite_shield',
  'reinforced_targe',
  'vatican_aspis',
  'battersea_shield',
  'dipylon_shield',
  'enderby_shield',
  'pelte',
  'shield_of_the_valkyrie',
  'skjaldmaer',
  'luzon_tribal_shield',
  'aegis',
  'helm_of_darkness',
];
const ARMOR_KEYS = [...MIGRATED_ARMOR_KEYS, ...NEW_ARMOR_KEYS];
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
  const enemyEffectTags = new Set(overrides.enemyEffectTags || []);
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
    damageReductionPct: 0,
    incomingDamageIncreasePct: 0,
    playerAtkMult: 0,
    playerDefMult: 0,
    ignoreDefPct: 0,
    nextAttackAutoCrit: false,
    nextAttackDouble: false,
    rng: () => 0,
    enemyDebuffs,
    playerDebuffs,
    enemyImmune: (tag) => immune.has(tag),
    enemyHasEffectTag: (tag) => enemyEffectTags.has(tag),
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
    if (!['playerDebuffs', 'enemyImmuneTags', 'enemyEffectTags'].includes(key)) bs[key] = value;
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
};
for (const [key, [chance, flag]] of Object.entries(DEFENSIVE_CHANCES)) {
  audit(key, () => {
    const proc = makeBs({ rng: () => 0 });
    invoke(key, proc);
    assert.equal(proc.flags[flag], true, `${key} proc flag`);
    const boundary = makeBs({ rng: () => chance });
    invoke(key, boundary);
    assert.equal(boundary.flags[flag], false, `${key} exact boundary does not proc`);
  });
}

audit('freyrs_arrow', () => {
  const proc = makeBs({ rng: () => 0 });
  invoke('freyrs_arrow', proc);
  attack(proc);
  assert.equal(proc.flags.auto_fire_shot, true);
  const boundary = makeBs({ rng: () => 0.30 });
  invoke('freyrs_arrow', boundary);
  attack(boundary);
  assert.equal(boundary.flags.auto_fire_shot, undefined);
  const additional = makeBs({ rng: () => 0, allowAdditionalAttackProcs: false });
  invoke('freyrs_arrow', additional);
  attack(additional);
  assert.equal(additional.flags.auto_fire_shot, undefined);
});

audit('galdrastafir', () => {
  const bs = makeBs({ rng: () => 0.99 });
  invoke('galdrastafir', bs);
  land(bs);
  assert.deepEqual(bs.enemyDebuffs[0], { tag: 'def_down', turns: 2, value: 0.20 });
});

audit('spear_of_ares', () => {
  const bs = makeBs();
  for (let turn = 1; turn <= 10; turn += 1) {
    bs.currentTurn = turn;
    bs.playerAtkMult = 0;
    invoke('spear_of_ares', bs);
  }
  close(bs.playerAtkMult, 0.50, 'Spear of Ares stack cap');
  assert(bs.log.some((line) => line.includes('ATK +50% (5 stacks)')));
});

audit('juru_pakal', () => {
  const normal = makeBs();
  invoke('juru_pakal', normal);
  attack(normal);
  close(normal.playerAtkMult, 0.10, 'Juru Pakal base damage');
  const bleeding = makeBs({ enemyEffectTags: ['bleed'] });
  invoke('juru_pakal', bleeding);
  attack(bleeding);
  close(bleeding.playerAtkMult, 0.60, 'Juru Pakal bonus against bleed-tagged effects');
});

audit('enderby_shield', () => {
  const bs = makeBs({ rng: () => 0.99 });
  invoke('enderby_shield', bs);
  close(bs.flags.enderby_reflect_pct, 0.12, 'Enderby reflect');
});

audit('pelte', () => {
  const bs = makeBs();
  invoke('pelte', bs);
  assert.equal(bs.flags.pelte_active, true);
});

audit('gridr_iron_gloves', () => {
  const bs = makeBs();
  invoke('gridr_iron_gloves', bs);
  close(bs.playerAtkMult, 0.20, 'Gridr base damage');
  assert.equal(bs.flags.gridr_ironhide_active, true);
});

audit('skjaldmaer', () => {
  const bs = makeBs();
  invoke('skjaldmaer', bs);
  assert.equal(bs.flags.skjaldmaer_active, true);
  close(bs.flags.skjaldmaer_reflect_pct, 0.20, 'Skjaldmaer normal reflect');
});

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
  close(bs.playerAtkMult, 0.12, 'Vatican damage');
  close(bs.damageReductionPct, 0.08, 'Vatican reduction');
});

audit('battersea_shield', () => {
  const bs = makeBs();
  for (let turn = 1; turn <= 8; turn += 1) {
    bs.currentTurn = turn;
    bs.damageReductionPct = 0;
    invoke('battersea_shield', bs);
  }
  close(bs.damageReductionPct, 0.15, 'Battersea reduction cap');
});

audit('dipylon_shield', () => {
  const active = makeBs({ currentTurn: 3 });
  invoke('dipylon_shield', active);
  close(active.playerDefMult, 0.30, 'Dipylon active window');
  const expired = makeBs({ currentTurn: 4 });
  invoke('dipylon_shield', expired);
  close(expired.playerDefMult, 0, 'Dipylon expires');
});

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
  const additional = makeBs({ rng: () => 0, allowAdditionalAttackProcs: false });
  invoke('scandinavian_glacial_wooden_bow', additional);
  attack(additional);
  assert.equal(additional.flags.extra_turn, undefined);
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
  const bs = makeBs({ enemyHP: 51, enemyMaxHP: 100 });
  invoke('gram', bs);
  close(bs.ignoreDefPct, 0.25, 'Gram pierce');
  attack(bs);
  close(bs.playerAtkMult, 0.30, 'Gram healthy-target bonus');
});

audit('tyrfing', () => {
  const bs = makeBs();
  invoke('tyrfing', bs);
  close(bs.playerAtkMult, 0.10, 'Tyrfing first stack');
  assert.equal(bs.flags.attacks_cannot_miss, undefined);
  for (let i = 0; i < 3; i += 1) {
    bs.playerAtkMult = 0;
    invoke('tyrfing', bs);
  }
  close(bs.playerAtkMult, 0.30, 'Tyrfing stack cap');
  assert(bs.log.some((line) => line.includes('ATK +30% (max stacks)')));
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
  close(bs.playerAtkMult, 0.20, 'Jarngreipr base damage');
});

audit('alans_reversed_hands', () => {
  const bs = makeBs({ playerDebuffs: [
    { tag: 'stun', category: EFFECT_CATEGORY.STATUS },
    { tag: 'burn', category: EFFECT_CATEGORY.DOT },
  ] });
  invoke('alans_reversed_hands', bs);
  assert.equal(bs.playerStatusImmune, true);
  assert.deepEqual(bs.playerDebuffs.map((d) => d.tag), ['burn']);
  close(bs.playerAtkMult, 0.20, 'Alan base damage');
});

audit('knuckle_charm_anting_anting', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('knuckle_charm_anting_anting', bs);
  close(bs.playerAtkMult, 0.10, 'Death Charm base damage');
  attack(bs);
  assert.equal(bs.flags.instakill_check, undefined);
  land(bs);
  assert.equal(bs.flags.instakill_check, true);
  const boundary = makeBs({ rng: () => 0.05 });
  invoke('knuckle_charm_anting_anting', boundary);
  attack(boundary);
  land(boundary);
  assert.equal(boundary.flags.instakill_check, undefined);
  const boss = makeBs({ rng: () => 0, enemyImmuneTags: ['boss_immune'] });
  invoke('knuckle_charm_anting_anting', boss);
  attack(boss);
  land(boss);
  assert.equal(boss.flags.instakill_check, undefined);
  assert(boss.log.some((line) => line.includes('no effect on bosses')));
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
  assert.deepEqual(bs.enemyDebuffs, [
    { tag: 'rupture', turns: 2, value: 0 },
    { tag: 'venom', turns: 2, value: 10 },
  ]);
  const boundary = makeBs({ rng: () => 0.30 });
  invoke('badiang_stalk', boundary);
  attack(boundary);
  land(boundary);
  assert.equal(boundary.flags.rupture_check, undefined);
});

audit('shield_of_the_valkyrie', () => {
  const bs = makeBs();
  bs.flags.valkyrie_shield_dr = 0.10;
  bs.flags.valkyrie_shield_atk = 0.10;
  invoke('shield_of_the_valkyrie', bs);
  assert.equal(bs.flags.valkyrie_resolve_active, true);
  close(bs.playerAtkMult, 0.10, 'Valkyrie persistent ATK stacks');
  close(bs.damageReductionPct, 0.10, 'Valkyrie persistent reduction stacks');
});

audit('luzon_tribal_shield', () => {
  const bs = makeBs({ playerDebuffs: [{ tag: 'burn' }] });
  invoke('luzon_tribal_shield', bs);
  close(bs.playerDefMult, 0.45, 'Luzon debuffed DEF');
});

audit('gusisnautar', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('gusisnautar', bs);
  attack(bs);
  land(bs);
  assert.equal(bs.flags.hemorrhage_check, true);
  close(bs.flags.hemorrhage_pct, 0.05, 'Gusisnautar hemorrhage amount');
  assert.deepEqual(bs.enemyDebuffs, [
    { tag: 'hemorrhage', turns: 2, value: 0 },
    { tag: 'def_down', turns: 2, value: 0.15 },
  ]);
  const boundary = makeBs({ rng: () => 0.50 });
  invoke('gusisnautar', boundary);
  attack(boundary);
  land(boundary);
  assert.equal(boundary.flags.hemorrhage_check, undefined);
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
    bs.incomingDamageIncreasePct = 0;
    invoke('sword_of_damocles', bs);
  }
  close(bs.playerAtkMult, 1, 'Damocles ATK cap');
  close(bs.incomingDamageIncreasePct, 0.10, 'Damocles incoming penalty');
});

audit('labrys', () => {
  const bs = makeBs({ currentTurn: 3 });
  invoke('labrys', bs);
  assert.equal(bs.flags.labrys_double_hit, undefined);
  attack(bs);
  assert.equal(bs.flags.labrys_double_hit, true);
  close(bs.flags.labrys_second_hit_pct, 0.70, 'Labrys second hit');
  const additional = makeBs({ currentTurn: 3, allowAdditionalAttackProcs: false });
  invoke('labrys', additional);
  attack(additional);
  assert.equal(additional.flags.labrys_double_hit, undefined);
});

audit('hephaestus_hammer', () => {
  const bs = makeBs({ currentTurn: 4 });
  invoke('hephaestus_hammer', bs);
  close(bs.playerDefMult, 0.20, 'Hammer permanent DEF');
  attack(bs);
  close(bs.playerAtkMult, 1.50, 'Hammer forge strike');
  const additional = makeBs({ currentTurn: 4, isPrimaryAttack: false });
  invoke('hephaestus_hammer', additional);
  attack(additional);
  close(additional.playerAtkMult, 0, 'Hammer additional attack');
});

audit('caduceus', () => {
  // Herald's Touch is now +10% damage and -10% incoming DOT. It no longer cleanses or
  // heals — that was replaced outright, not extended, so those are asserted ABSENT.
  const bs = makeBs({ currentTurn: 3, playerHP: 50, playerDebuffs: [{ tag: 'burn' }] });
  invoke('caduceus', bs);
  close(bs.playerAtkMult, 0.10, 'Herald\'s Touch damage');
  assert.equal(bs.flags.caduceus_dot_reduction, 0.10);
  assert.equal(bs.playerDebuffs.length, 1, 'no longer cleanses debuffs');
  assert.equal(bs.playerHP, 50, 'no longer heals');

  // Not turn-gated any more: the same values apply on every turn.
  const other = makeBs({ currentTurn: 5, playerHP: 50 });
  invoke('caduceus', other);
  close(other.playerAtkMult, 0.10, 'Herald\'s Touch damage off-cycle');
  assert.equal(other.flags.caduceus_dot_reduction, 0.10);
});

audit('helm_of_darkness', () => {
  const bs = makeBs();
  invoke('helm_of_darkness', bs);
  assert.equal(bs.flags.helm_darkness_active, true);
});

audit('aegis', () => {
  // 10% per Stone stack. Two stacks is the effective MAXIMUM (20%): the third is
  // consumed by the Petrify and its reduction is rolled back in the same step, which
  // grantAegisStone in battleEngine owns. 30% + a Petrify would strictly dominate Mail
  // of Brokkr's flat 30%, so this cap is deliberate and pinned here so it cannot drift.
  const bs = makeBs({ flags: { aegis_stacks: 2 } });
  invoke('aegis', bs);
  assert.equal(bs.flags.aegis_active, true);
  close(bs.damageReductionPct, 0.20, 'Aegis at the 2-stack maximum');

  const one = makeBs({ flags: { aegis_stacks: 1 } });
  invoke('aegis', one);
  close(one.damageReductionPct, 0.10, 'Aegis one stack');

  const fresh = makeBs();
  invoke('aegis', fresh);
  close(fresh.damageReductionPct, 0, 'Aegis grants no reduction before the first hit');
});

audit('apollos_silver_bow', () => {
  // The crit cycle counts the WIELDER'S OWN attack turns, not the round clock, so this
  // drives repeated attacks on one battle state rather than setting currentTurn.
  // A fresh state per turn, carrying flags forward — flags are battle-scoped in the
  // engine while attack hooks are re-registered each round by resetScratch. Reusing one
  // state would stack hooks and advance the counter more than once per turn.
  let flags = {};
  const turn = () => {
    const bs = makeBs({ flags });
    invoke('apollos_silver_bow', bs);
    attack(bs);
    flags = bs.flags;
    return bs;
  };

  const first = turn();
  close(first.ignoreDefPct, 0.25, 'Apollo bow pierce');
  assert.equal(first.nextAttackAutoCrit, false, 'attack turn 1: no crit');
  assert.equal(turn().nextAttackAutoCrit, false, 'attack turn 2: no crit');
  assert.equal(turn().nextAttackAutoCrit, true, 'attack turn 3: guaranteed crit');
  assert.equal(flags.apollo_attack_turns, 3);
  assert.equal(turn().nextAttackAutoCrit, false, 'attack turn 4: cycle resets');
  assert.equal(turn().nextAttackAutoCrit, false, 'attack turn 5: no crit');
  assert.equal(turn().nextAttackAutoCrit, true, 'attack turn 6: crits again');

  // Additional attacks ride along on the primary's turn and must not advance the count.
  const additional = makeBs({ isPrimaryAttack: false });
  invoke('apollos_silver_bow', additional);
  attack(additional);
  assert.equal(additional.nextAttackAutoCrit, false);
  assert.equal(additional.flags.apollo_attack_turns || 0, 0, 'extra attacks do not count');
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
  const additional = makeBs({ currentTurn: 3, isPrimaryAttack: false });
  invoke('mjolnir', additional);
  attack(additional);
  close(additional.playerAtkMult, 0.30, 'Mjolnir additional attack');
});

audit('gungnir', () => {
  const bs = makeBs({ rng: () => 0 });
  invoke('gungnir', bs);
  close(bs.ignoreDefPct, 0.30, 'Gungnir base pierce');
  assert.equal(bs.flags.gungnir_full_pierce, undefined);
  attack(bs);
  assert.equal(bs.flags.gungnir_full_pierce, true);
  // The full-pierce roll is a SEPARATE 10% chance from the 30% DEF ignore, and it
  // supersedes rather than stacks — the engine zeroes DEF outright on a pierce.
  const boundary = makeBs({ rng: () => 0.10 });
  invoke('gungnir', boundary);
  attack(boundary);
  assert.equal(boundary.flags.gungnir_full_pierce, false, '0.10 is outside a 10% chance');
  const inside = makeBs({ rng: () => 0.099 });
  invoke('gungnir', inside);
  attack(inside);
  assert.equal(inside.flags.gungnir_full_pierce, true, '0.099 is inside a 10% chance');
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
  const additional = makeBs({ currentTurn: 2, rng: () => 0, isPrimaryAttack: false });
  invoke('trident_of_poseidon', additional);
  attack(additional);
  land(additional);
  close(additional.playerAtkMult, 0, 'Trident additional attack');
  assert.equal(additional.enemyDebuffs.length, 0);
});

// ── Genesis tier — the five First Arms (specs/genesis_tier_weapons.md) ──────

assert.equal(GENESIS_STATS.bonus_dmg_pct, 100, 'Genesis fixed damage rider is +100%');
assert.equal(rollWeaponStats('Genesis', 'Sword').bonus_dmg_pct, 100,
  'new Genesis drops store the fixed +100% rider');
assert.equal(effectiveWeaponBonusDmgPct('Genesis', 50), 100,
  'legacy Genesis rows use the replacement +100% value, not 50% + 100%');
assert.equal(effectiveWeaponBonusDmgPct('Supreme', SUPREME_STATS.bonus_dmg_pct), 50,
  'Supreme damage rider remains unchanged');
const genesisDisplay = weaponEntry({
  name: 'Kiri', tier: 'Genesis', enhancement: 1,
  curr_atk: 1_600, crit: 20, bonus_dmg_pct: 50,
  passive_name: 'Thousand Partings', passive_description: 'Unchanged.',
}, 'test-id');
assert(genesisDisplay.includes('+100% DMG') && !genesisDisplay.includes('+50% DMG'),
  'owned Genesis comparison display normalizes legacy rows to +100%');
for (const relative of [
  'src/commands/rpg/equipment.js',
  'src/commands/rpg/open.js',
]) {
  const displaySource = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  assert(displaySource.includes('effectiveWeaponBonusDmgPct'),
    `${relative} must render Genesis damage from the centralized fixed-tier helper`);
}

audit('kiri', () => {
  // Ramp is attack-bound: +20% per attack, capped at +120%.
  const bs = makeBs({ rng: () => 0.99 }); // no double-strike proc
  invoke('kiri', bs);
  close(bs.playerAtkMult, 0, 'kiri waits for an attack');
  attack(bs);
  close(bs.playerAtkMult, 0.20, 'kiri first attack');
  assert(bs.log.some((line) => line.includes('Damage +20% (total +20%)')),
    'kiri logs the first damage-stack increase');
  for (let i = 0; i < 10; i++) {
    bs.playerAtkMult = 0;
    attack(bs);
  }
  close(bs.playerAtkMult, 1.20, 'kiri stack caps at +120%');
  assert.equal(bs.nextAttackDouble, false, 'kiri does not double on a failed roll');

  const proc = makeBs({ rng: () => 0.10 }); // < 0.25 → double strike
  invoke('kiri', proc);
  attack(proc);
  assert.equal(proc.nextAttackDouble, true, 'kiri 25% double strike');
  assert(proc.log.some((line) => line.includes('Double strike triggered')),
    'kiri logs a successful double-strike proc');
});

audit('moira', () => {
  const bs = makeBs();
  invoke('moira', bs);
  assert.equal(bs.enemyDebuffs.length, 0, 'moira waits for a landed hit');
  land(bs);
  assert(bs.enemyDebuffs.some((d) => d.tag === 'def_down' && d.value === 0.10), 'moira first shred');
  assert.equal(bs.flags.attacks_cannot_miss, true, 'moira attacks cannot miss');
  assert.equal(bs.flags.moira_pierce_vs_def_buff, true, 'moira arms the conditional pierce');
  for (let i = 0; i < 10; i++) land(bs);
  close(bs.flags.moira_def_stack, 0.50, 'moira shred caps at -50%');

  const immune = makeBs({ enemyImmuneTags: ['def_down'] });
  invoke('moira', immune);
  land(immune);
  close(immune.flags.moira_def_stack || 0, 0, 'moira shred respects immunity');
  assert.equal(immune.flags.attacks_cannot_miss, true, 'moira no-miss is not gated by immunity');
});

audit('sophia', () => {
  const healthy = makeBs({ playerHP: 100, playerMaxHP: 100 });
  invoke('sophia', healthy);
  close(healthy.playerAtkMult, 0.75, 'sophia base damage bonus');
  close(healthy.incomingDamageIncreasePct, 0.20, 'sophia incoming damage penalty');
  assert(healthy.log.some((line) => line.includes('Damage +75%; damage taken +20%')),
    'sophia logs its base tradeoff once');

  const wounded = makeBs({ playerHP: 29, playerMaxHP: 100 });
  invoke('sophia', wounded);
  close(wounded.playerAtkMult, 1.50, 'sophia awakens below 30% HP');
  // Sticky for the rest of the battle even after healing above the threshold.
  wounded.playerHP = 90;
  wounded.playerAtkMult = 0;
  invoke('sophia', wounded);
  close(wounded.playerAtkMult, 1.50, 'sophia awakening persists');
});

audit('atlas', () => {
  const off = makeBs({ currentTurn: 2 });
  invoke('atlas', off);
  close(off.playerAtkMult, 0.50, 'atlas flat ATK bonus');
  assert(off.log.some((line) => line.includes('Base ATK +50%')),
    'atlas logs its permanent attack bonus once');
  assert.equal(off.nextAttackAutoCrit, false, 'atlas does not auto-crit off-cadence');
  assert.equal(off.flags.atlas_crit_atk_down, true, 'atlas arms the on-crit ATK cut');

  const third = makeBs({ currentTurn: 3 });
  invoke('atlas', third);
  assert.equal(third.nextAttackAutoCrit, true, 'atlas every 3rd turn is a guaranteed crit');
});

audit('titan', () => {
  const healthy = makeBs({ playerHP: 80, playerMaxHP: 100 });
  invoke('titan', healthy);
  close(healthy.flags.titan_lifesteal_pct, 0.30, 'titan base lifesteal');
  assert.equal(healthy.flags.titan_reprieve_available, true, 'titan arms the reprieve');
  assert(healthy.log.some((line) => line.includes('Lifesteal 30%')),
    'titan logs its active lifesteal rate');
  assert(healthy.log.some((line) => line.includes('Fatal reprieve armed')),
    'titan logs its once-per-battle reprieve state');

  const wounded = makeBs({ playerHP: 40, playerMaxHP: 100 });
  invoke('titan', wounded);
  close(wounded.flags.titan_lifesteal_pct, 0.50, 'titan lifesteal below 50% HP');

  const spent = makeBs({ playerHP: 50, playerMaxHP: 100, flags: { titan_reprieve_used: true, titan_atk_bonus: 1.00 } });
  invoke('titan', spent);
  assert(!spent.flags.titan_reprieve_available, 'titan reprieve is once per battle');
  close(spent.playerAtkMult, 1.00, 'titan post-reprieve damage bonus');
});

assert.deepEqual(
  [...tested].sort(),
  [...WEAPON_KEYS].sort(),
  'every authoritative weapon key must have one explicit audit contract',
);

// The eight armor-only handlers use the same registry and perspective contract.
// Shared shield/armor keys already have exact contracts in the weapon audit above.
{
  assert.deepEqual(NEW_ARMOR_KEYS, [
    'kalasag',
    'hoplite_panoply',
    'mail_of_brokkr',
    'wolfskin_cloak',
    'salakot_ward',
    'anting_anting_sash',
    'valkyrie_mantle',
    'mantle_of_bathala',
  ]);

  const kalasag = makeBs();
  invoke('kalasag', kalasag);
  close(kalasag.damageReductionPct, 0.03, 'Kalasag reduction');

  const hoplite = makeBs();
  invoke('hoplite_panoply', hoplite);
  close(hoplite.damageReductionPct, 0.20, 'Hoplite Panoply base reduction');
  assert.equal(hoplite.flags.phalanx_wall_active, true);

  const brokkr = makeBs();
  invoke('mail_of_brokkr', brokkr);
  close(brokkr.damageReductionPct, 0.30, 'Mail of Brokkr reduction');
  close(brokkr.flags.mail_brokkr_reflect, 0.20, 'Mail of Brokkr reflect');
  close(brokkr.flags.mail_brokkr_hit_cap, 0.15, 'Mail of Brokkr hit cap');

  const wolf = makeBs({ playerHP: 40, playerMaxHP: 100 });
  invoke('wolfskin_cloak', wolf);
  assert.equal(wolf.playerHP, 46, 'Wolfskin Cloak uses the below-half 6% heal');

  const salakot = makeBs();
  invoke('salakot_ward', salakot);
  close(salakot.flags.salakot_negate_chance, 0.35, 'Salakot Ward negate chance');

  const sash = makeBs();
  invoke('anting_anting_sash', sash);
  assert.equal(sash.flags.charmed_hide_active, true);

  const mantle = makeBs();
  invoke('valkyrie_mantle', mantle);
  assert.equal(mantle.flags.chooser_grace_active, true);
  close(mantle.flags.chooser_grace_chance, 0.22, 'Valkyrie Mantle base evade');

  const bathala = makeBs();
  invoke('mantle_of_bathala', bathala);
  close(bathala.flags.bathala_hp_fraction, 0.06, 'Mantle of Bathala max-HP stack');
  close(bathala.damageReductionPct, 0.04, 'Mantle of Bathala reduction stack');
  close(bathala.flags.mantle_bathala_heal_pct, 0, 'Mantle heal waits for max stacks');
}

// Migration 08 must persist the registry key, not only the display name. The
// upsert contract also repairs rows created by an older/incomplete copy.
{
  const migrationPath = path.join(
    ROOT,
    'scripts',
    'migrations',
    '20260720_08_genesis_weapons.sql',
  );
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const compactMigration = migration.replace(/\s+/g, ' ');
  const genesisWeapons = [
    [78, 'Kiri', 'Sword', 'Japanese', 'kiri'],
    [79, 'Moira', 'Bow', 'Greek', 'moira'],
    [80, 'Sophia', 'Staff', 'Greek', 'sophia'],
    [81, 'Atlas', 'Gloves', 'Greek', 'atlas'],
    [82, 'Titan', 'Greatsword', 'Greek', 'titan'],
  ];

  assert.match(
    migration,
    /INSERT INTO public\.weapon_roster\s*\([\s\S]*?passive_key[\s\S]*?passive_name[\s\S]*?\)\s*VALUES/,
    'Genesis weapon insert must explicitly include passive_key',
  );
  for (const [id, name, type, mythology, key] of genesisWeapons) {
    assert(
      compactMigration.includes(
        `(${id}, '${name}', '${type}', 'Genesis', '${mythology}', '${key}',`,
      ),
      `${name} migration row must store passive_key '${key}'`,
    );
    assert(WEAPON_KEYS.includes(key), `${key} must exist in the documented weapon registry`);
    assert.equal(typeof PASSIVES[key], 'function', `${key} must be exported by passiveRegistry`);
  }
  assert.match(
    migration,
    /ON CONFLICT \(weapon_roster_id\) DO UPDATE SET/,
    'Genesis migration must repair an existing expected-id row',
  );
  assert.match(
    migration,
    /passive_key\s*=\s*EXCLUDED\.passive_key/,
    'Genesis upsert must repair passive_key',
  );
  assert.doesNotMatch(
    migration,
    /SELECT\s+v\.\*\s+FROM\s+\(VALUES/,
    'Genesis migration must not silently skip an existing row with a stale passive_key',
  );
  const constraintRepairAt = migration.indexOf('DO $genesis_weapon_constraints$');
  const weaponInsertAt = migration.indexOf('INSERT INTO public.weapon_roster');
  assert(constraintRepairAt >= 0, 'Genesis migration must repair live weapon CHECK constraints');
  assert(
    constraintRepairAt < weaponInsertAt,
    'Genesis tier/type CHECK constraints must be repaired before inserting Genesis rows',
  );
  assert.match(
    migration,
    /FROM unnest\(c\.conkey\)[\s\S]*?a\.attname IN \('tier', 'type'\)/,
    'Genesis migration must find legacy tier/type checks even when their names drift',
  );
  assert.match(migration, /weapon_roster_tier_check[\s\S]*?'Genesis'/);
  assert.match(migration, /weapon_roster_type_check[\s\S]*?'Greatsword'/);

  const glossary = fs.readFileSync(
    path.join(ROOT, 'src', 'commands', 'rpg', 'glossary.js'),
    'utf8',
  );
  assert.match(
    glossary,
    /SUPREME_STATS, GENESIS_STATS/,
    'weapon glossary must use the fixed Genesis stat source',
  );
  assert.match(
    glossary,
    /WHEN 'Genesis' THEN 6 WHEN 'Supreme' THEN 5/,
    'Genesis weapons must sort above Supreme in the glossary',
  );
  assert.match(
    glossary,
    /g\.tier === 'Genesis'[\s\S]*?GENESIS_STATS\.atk[\s\S]*?GENESIS_STATS\.crit[\s\S]*?GENESIS_STATS\.bonus_dmg_pct/,
    'Genesis glossary rows must render their fixed ATK, CRIT, and damage stats',
  );
}

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

// Bloodhunter's real damage path is additive: +10% at all times, then another
// +50% while any bleed-family effect is active. Swordsman now contributes its
// own +5%/turn stack, so compare against the raw ATK lanes rather than treating
// Bloodhunter's modifiers as a multiplier of the already-boosted baseline.
{
  const swordsman = (weaponPassiveKey) => player({
    class: 'Swordsman',
    classPassive: 'bleed',
    weaponPassiveKey,
  });
  const target = mob({ mobType: 'boss', hp: 100000, atk: 0, def: 0 });
  const baseline = resolveBattle(
    swordsman('none'),
    target,
    { mode: 'boss', rng: () => 0.5 },
  );
  const bloodhunter = resolveBattle(
    swordsman('juru_pakal'),
    target,
    { mode: 'boss', rng: () => 0.5 },
  );
  assert.equal(
    firstAttackDamage(bloodhunter),
    115,
    'Juru Pakal must deal 10% more damage before Bleed is active',
  );
  assert.equal(
    attackDamageOnRound(bloodhunter, 2),
    170,
    'Juru Pakal must deal 60% more total damage while ordinary Bleed is active',
  );
  assert(has(roundEvents(bloodhunter, 1), 'Bloodhunter — outgoing damage +10%'));
  assert(has(roundEvents(bloodhunter, 2), 'target is bleeding, +50% damage'));
}

// Every armor passive must surface the state it actually applies. Persistent
// effects announce once; chance/reactive effects announce only after they fire.
{
  const reactiveSkill = new Set([
    'luzon_tribal_shield',
    'salakot_ward',
    'anting_anting_sash',
  ]);
  const expectedLog = {
    steel_kite_shield: 'Steel Kite Shield: Bulwark',
    reinforced_targe: 'Reinforced Targe: Opening Strike',
    vatican_aspis: 'Vatican Aspis: Sacred Guard',
    battersea_shield: 'Iron Stance',
    dipylon_shield: 'Dipylon Shield: Hoplite Wall',
    enderby_shield: 'Thornward reflects',
    pelte: 'Deflection',
    shield_of_the_valkyrie: "Valkyrie's Resolve",
    skjaldmaer: "Shieldmaiden's Guard",
    luzon_tribal_shield: 'Tribal Ward',
    aegis: "Medusa's Gaze",
    helm_of_darkness: 'Veil of Hades',
    kalasag: 'Kalasag: Bulwark Hide',
    hoplite_panoply: 'Phalanx Wall',
    mail_of_brokkr: 'Dwarven Forge',
    wolfskin_cloak: "Wolf's Vigor",
    salakot_ward: 'Spirit Ward',
    anting_anting_sash: 'Charmed Hide',
    valkyrie_mantle: "Chooser's Grace",
    mantle_of_bathala: 'Divine Aegis',
  };
  assert.deepEqual(
    Object.keys(expectedLog).sort(),
    ARMOR_KEYS.slice().sort(),
    'armor battle-log audit must cover every authoritative armor key',
  );
  for (const key of ARMOR_KEYS) {
    const sim = resolveBattle(
      player({
        atk: 0,
        hp: 10000,
        def: 0,
        armorPassiveKey: key,
      }),
      mob({
        atk: 100,
        hp: 10000,
        def: 0,
        skillKey: reactiveSkill.has(key) ? 'stone_stare' : 'none',
      }),
      { mode: 'boss', rng: () => 0 },
    );
    assert(
      has(events(sim), expectedLog[key]),
      `${key}: expected battle log containing "${expectedLog[key]}"`,
    );
  }
}

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
// acting first cannot let a weapon debuff bypass Salakot Ward.
{
  const swordRolls = [0, 0.99, 0.99, 0];
  const sword = resolveBattle(
    player({ weaponPassiveKey: 'laevateinn_sword' }),
    player({ name: 'Warded', atk: 0, armorPassiveKey: 'salakot_ward' }),
    { mode: 'duel', rng: () => swordRolls.shift() ?? 0.5 },
  );
  assert(has(roundEvents(sword, 1), 'negated DEF Down'));
  assert(!has(roundEvents(sword, 1), 'Laevateinn Sword: Sundering Flame'));
}

// Two landed sub-hits immediately grant two distinct Valkyrie Resolve stacks.
{
  const sim = resolveBattle(
    player({ weaponPassiveKey: 'shield_of_the_valkyrie', atk: 1 }),
    mob({ atk: 10, specialFlags: { multi_attack: 2, multi_attack_pct: 1 } }),
    { rng: () => 0.9 },
  );
  assert(has(roundEvents(sim, 1), '2 stacks · 10% reduction · +10% ATK'));
}

// Japanese Bo heals from the finishing hit, not only non-lethal hits.
// [b4c6c0d] Raids always start with the player now, so the mob must survive
// round 1 (hp 1100) to damage the player before round 2's lethal proc hit;
// the pre-fix scenario (mob hp 100, mob acting first via the order roll) can
// no longer occur in raid mode.
{
  const rolls = [0.9, 0.99, 0.99, 0.5, 0.5, 0.5, 0.5, 0];
  const sim = resolveBattle(
    player({ weaponPassiveKey: 'japanese_bo', atk: 1000, hp: 2000 }),
    mob({ atk: 1000, hp: 1100 }),
    { rng: () => rolls.shift() ?? 0.5 },
  );
  assert.equal(sim.winner, 'a');
  assert.equal(sim.a.hp, 1500, 'Japanese Bo should heal 500 from the lethal hit');
  assert(has(events(sim), 'Vital Siphon — healed 500 HP.'));
}

// Damage-based healing logs use the passive name and actual restored HP only.
{
  const sim = resolveBattle(
    player({
      atk: 1000,
      hp: 2000,
      effectRunes: [{ effect_key: 'vampiric', value: 20 }],
    }),
    mob({ atk: 0, hp: 100 }),
    { rng: () => 0.5 },
  );
  const lifestealEvent = events(sim).find((event) => event.includes('Vampiric Rune'));
  assert(lifestealEvent, 'Vampiric Rune activation must appear in the battle log');
  assert(lifestealEvent.endsWith('Vampiric Rune — healed 0 HP.'));
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
  assert(!has(events(sim), 'Vital Siphon — healed'));
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
  assert(!has(events(immune), 'Bash deals'));
  const success = resolveBattle(
    player({ class: 'Fighter', classPassive: 'stun', weaponPassiveKey: 'jarngreipr' }),
    mob(),
    { rng: () => 0 },
  );
  assert(has(events(success), 'Bash deals'));
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
  // Fighter's permanent +50% and Jarngreipr's +20% share the additive ATK lane:
  // 170% total, not 150% × 120% = 180%. Tolerance covers the final integer floor.
  const jarngreiprOverFighter = 1.70 / 1.50;
  assert(
    Math.abs(firstAttackDamage(armoredJarngreipr)
      - firstAttackDamage(armoredBaseline) * jarngreiprOverFighter) <= 1,
    'Jarngreipr keeps only its base bonus when stun is blocked: got '
    + `${firstAttackDamage(armoredJarngreipr)}, expected ~`
    + `${firstAttackDamage(armoredBaseline) * jarngreiprOverFighter}`,
  );
  assert(!has(events(armoredJarngreipr), 'Bash deals'));

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
  assert(has(events(wardedJarngreipr), 'negated Stun'));
  close(
    firstAttackDamage(wardedJarngreipr),
    firstAttackDamage(wardedBaseline) * jarngreiprOverFighter,
    'Jarngreipr keeps only its base bonus when Spirit Ward blocks stun',
  );
  assert(!has(events(wardedJarngreipr), 'Bash deals'));
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
