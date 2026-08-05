'use strict';

/**
 * PHASE 6 STATIC SELF-TEST — battle engine + passive registry.
 *
 * Runs with NO database, NO Discord, NO env (sandbox-safe):
 *   node scripts/battle-selftest.js
 *
 * Sections:
 *   1. Coverage      — registry keys ⇄ passive_registry_keys.md (exact set equality)
 *   2. Purity        — no Math.random in battleEngine.js / passiveRegistry.js
 *   3. Determinism   — 100 seeds, resolveBattle twice → byte-identical sims
 *   4. Targeted      — exact-math + behavioral scenarios with scripted RNG
 *                      (crit/katana/Supreme riders, Knight DR, Archer pierce,
 *                       Overcharge, instakill, rupture/hemorrhage, immunities,
 *                       Sleipnir, Cerberus, Hydra net damage, Sidapa, sudden
 *                       death, round-50 cap, R2/R8/R9/C1, R3 evade-no-consume)
 *   5. Fuzz          — ~2,000 seeded battles across all registry keys; invariants
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const {
  ARCHER_DOUBLE_ATTACK_CHANCE,
  BLEED_MAX_PCT,
  BLEED_MAX_STACKS,
  BLEED_PCT_PER_STACK,
  FIGHTER_BASH_DAMAGE_PCT,
  FIGHTER_STUN_CHANCE,
  FIGHTER_STUN_TURNS,
  resolveBattle,
  rngOf,
} = require(path.join(ROOT, 'src', 'engine', 'battleEngine'));
const PASSIVE_REGISTRY = require(path.join(ROOT, 'src', 'engine', 'passiveRegistry'));
const {
  EFFECT_CATEGORY,
  BLEED_TAG,
  EFFECT_DEFINITIONS,
  CANONICAL_ON_HIT_EFFECTS,
  effectCategory,
  effectHasTag,
  removeEffectsByCategory,
} = require(path.join(ROOT, 'src', 'engine', 'combatEffects'));
const {
  computeClassBattleStats, assemblePlayerStats, computeMobStats, computeBossStats,
} = require(path.join(ROOT, 'src', 'engine', 'statAssembly'));
const { applyCombatExp, EXP_REQUIRED, MAX_COMBAT_LEVEL } = require(path.join(ROOT, 'src', 'config', 'combatExp'));
const { CLASSES } = require(path.join(ROOT, 'src', 'config', 'classes'));
const { runeDescription } = require(path.join(ROOT, 'src', 'config', 'runes'));
const {
  GREATER_BOSSES, CALAMITY_BOSSES, CALAMITY_SPAWN_CHANCE, GREATER_SPAWN_CHANCE, NORMAL_SPAWN_CHANCE,
  GREATER_CHEST_GOLDEN_CHANCE, GREATER_TWIN_REWARD, GREATER_GOLDEN_REWARD,
  bossRewards, rollBossChest, hpMultiplierForChest, bossMaxHpForChest,
  inferChestFromGreaterHp, bossChestForSpawn, pickWeightedBoss,
} = require(path.join(ROOT, 'src', 'config', 'bosses'));

// ── tiny test framework ─────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed += 1; }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); }
}
function section(title) { console.log(`\n── ${title} ──`); }

// ── fixtures ────────────────────────────────────────────────────────────────
function player(over = {}) {
  return Object.assign({
    name: 'Hero', kind: 'player', class: 'Knight', classPassive: 'damage_reduction',
    level: 50, atk: 300, hp: 2000, def: 150, crit: 20,
    bonusDmgPct: 0,
    weaponPassiveKey: 'none', weaponName: 'Test Blade',
    deityBlessingKey: 'none', deityName: null,
  }, over);
}
function mob(over = {}) {
  return Object.assign({
    name: 'Dummy', kind: 'mob', mobType: 'regular', level: 10,
    atk: 100, hp: 3000, def: 80, crit: 0,
    skillKey: 'none', immunityTags: [], specialFlags: {},
  }, over);
}
/** Scripted rng: consumes vals in order, then returns fallback forever. */
function scripted(vals, fallback = 0.5) {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : fallback);
}
const allEvents = (sim) => sim.rounds.flatMap((r) => r.events);
const roundEvents = (sim, n) => (sim.rounds.find((r) => r.round === n) || { events: [] }).events;
const hasEvent = (events, frag) => events.some((e) => e.includes(frag));
/** First damage number from an attacker line matching `frag`. */
function dmgOf(events, frag) {
  for (const e of events) {
    if (!e.includes(frag)) continue;
    const m = /\*\*(\d+) DMG\*\*/.exec(e);
    if (m) return Number(m[1]);
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
section('1. Coverage — registry ⇄ passive_registry_keys.md');
{
  const md = fs.readFileSync(path.join(ROOT, 'assets', 'data', 'passive_registry_keys.md'), 'utf8');
  const mdKeys = new Set();
  for (const m of md.matchAll(/^- `([a-z0-9_]+)`/gm)) mdKeys.add(m[1]);
  const regKeys = new Set(Object.keys(PASSIVE_REGISTRY));

  const missing = [...mdKeys].filter((k) => !regKeys.has(k));
  const extra = [...regKeys].filter((k) => !mdKeys.has(k));
  check('every md key implemented', missing.length === 0, `missing: ${missing.join(', ')}`);
  check('no unlisted registry keys', extra.length === 0, `extra: ${extra.join(', ')}`);
  // 176 unique keys total — 175 effect keys + the shared `none` no-op. [v5] added
  // 8 armor passives and 26 echo blessing keys; aegis & helm_of_darkness were
  // already counted (migrated from shields). [Genesis update] +5 Genesis weapon
  // passives (kiri, moira, sophia, atlas, titan).
  check('expected key count (177 incl. none)', regKeys.size === 177, `got ${regKeys.size}`);
  for (const k of regKeys) {
    if (typeof PASSIVE_REGISTRY[k] !== 'function') check(`key ${k} is a function`, false);
  }
  check('all keys are functions', true);
}

// ════════════════════════════════════════════════════════════════════════════
section('2. Purity — no Math.random in engine/registry');
{
  // match actual invocations (comments legitimately mention the name)
  for (const f of ['battleEngine.js', 'passiveRegistry.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'engine', f), 'utf8');
    check(`${f} has no Math.random()`, !/Math\.random\s*\(/.test(src));
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('3. Determinism — 100 seeds, identical sims');
{
  const mk = () => [
    player({ class: 'Swordsman', classPassive: 'bleed', weaponPassiveKey: 'mjolnir', deityBlessingKey: 'surt_muspells_flame' }),
    mob({ skillKey: 'lamia_serpent_bite', hp: 8000 }),
  ];
  let ok = true, detail = '';
  for (let seed = 1; seed <= 100; seed++) {
    const [a1, b1] = mk();
    const [a2, b2] = mk();
    const s1 = JSON.stringify(resolveBattle(a1, b1, { mode: 'raid', seed }));
    const s2 = JSON.stringify(resolveBattle(a2, b2, { mode: 'raid', seed }));
    if (s1 !== s2) { ok = false; detail = `seed ${seed} diverged`; break; }
  }
  check('100-seed determinism', ok, detail);
}

// ════════════════════════════════════════════════════════════════════════════
section('4. Targeted scenarios');

check('class descriptions expose the updated Swordsman, Archer, and Fighter values',
  CLASSES.Swordsman.passiveLine.includes('4% Bleed')
    && CLASSES.Swordsman.passiveLine.includes('20%')
    && CLASSES.Archer.passiveLine.includes('25%')
    && CLASSES.Archer.passiveLine.includes('additional attack')
    && CLASSES.Fighter.passiveLine.includes('25%')
    && CLASSES.Fighter.passiveLine.includes('1 turn')
    && CLASSES.Fighter.passiveLine.includes('100%')
    && CLASSES.Fighter.passiveLine.includes('Dizzy'));

check('class base and per-level scaling match the balance table',
  JSON.stringify(Object.fromEntries(Object.entries(CLASSES).map(([name, config]) => [
    name,
    { base: config.base, scaling: config.scaling },
  ]))) === JSON.stringify({
    Swordsman: {
      base: { hp: 700, atk: 225, def: 225, crit: 5.0 },
      scaling: { hp: 150, atk: 75, def: 75, crit: 0.7 },
    },
    Fighter: {
      base: { hp: 850, atk: 300, def: 150, crit: 1.0 },
      scaling: { hp: 150, atk: 100, def: 50, crit: 0.5 },
    },
    Mage: {
      base: { hp: 600, atk: 350, def: 100, crit: 1.0 },
      scaling: { hp: 100, atk: 150, def: 50, crit: 0.5 },
    },
    Knight: {
      base: { hp: 1000, atk: 200, def: 300, crit: 5.0 },
      scaling: { hp: 200, atk: 70, def: 100, crit: 0.0 },
    },
    Archer: {
      base: { hp: 600, atk: 300, def: 150, crit: 5.0 },
      scaling: { hp: 125, atk: 125, def: 50, crit: 0.7 },
    },
  }));

// Genesis First Arms registry contracts.
{
  function genesisState(overrides = {}) {
    const attackHooks = [];
    const landedHitHooks = [];
    const enemyDebuffs = [];
    const state = {
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
      flags: {},
      log: [],
      playerAtkMult: 0,
      damageReductionPct: 0,
      incomingDamageIncreasePct: 0,
      nextAttackAutoCrit: false,
      nextAttackDouble: false,
      rng: () => 0.99,
      enemyDebuffs,
      enemyImmune: () => false,
      applyDebuff(tag, turns, value = 0) {
        const existing = enemyDebuffs.find((effect) => effect.tag === tag);
        if (existing) existing.value = Math.max(existing.value, value);
        else enemyDebuffs.push({ tag, turns, value });
        return true;
      },
      onAttack: (fn) => attackHooks.push(fn),
      onLandedHit: (fn) => landedHitHooks.push(fn),
      attackHooks,
      landedHitHooks,
      ...overrides,
    };
    return state;
  }

  const kiri = genesisState({ rng: () => 0.10 });
  PASSIVE_REGISTRY.kiri(kiri);
  kiri.attackHooks[0]();
  check('Genesis Kiri ramps and can double strike',
    kiri.playerAtkMult === 0.20 && kiri.nextAttackDouble === true);

  const moira = genesisState();
  PASSIVE_REGISTRY.moira(moira);
  check('Genesis Moira waits for a landed hit before applying shred',
    moira.enemyDebuffs.length === 0);
  moira.landedHitHooks[0]();
  check('Genesis Moira applies landed-hit shred, no-miss, and conditional pierce',
    moira.enemyDebuffs.some((effect) => effect.tag === 'def_down' && effect.value === 0.10)
    && moira.flags.attacks_cannot_miss === true
    && moira.flags.moira_pierce_vs_def_buff === true);

  const sophia = genesisState({ playerHP: 29 });
  PASSIVE_REGISTRY.sophia(sophia);
  check('Genesis Sophia awakens below 30 percent HP',
    sophia.playerAtkMult === 1.50 && sophia.incomingDamageIncreasePct === 0.20);

  const atlas = genesisState({ currentTurn: 3 });
  PASSIVE_REGISTRY.atlas(atlas);
  check('Genesis Atlas guarantees every third-round critical',
    atlas.playerAtkMult === 0.50 && atlas.nextAttackAutoCrit === true
    && atlas.flags.atlas_crit_atk_down === true);

  const titan = genesisState({ playerHP: 40 });
  PASSIVE_REGISTRY.titan(titan);
  check('Genesis Titan arms low-HP lifesteal and reprieve',
    titan.flags.titan_lifesteal_pct === 0.50
    && titan.flags.titan_reprieve_available === true);

  const kiriBattle = resolveBattle(
    player({
      weaponPassiveKey: 'kiri', weaponName: 'Kiri', classPassive: null,
      atk: 100, hp: 10_000, def: 0, crit: 0,
    }),
    mob({ atk: 0, hp: 10_000, def: 0 }),
    { mode: 'raid', rng: () => 0.10 },
  );
  const kiriRoundOne = roundEvents(kiriBattle, 1);
  check('Genesis Kiri battle log shows its +20% stack',
    hasEvent(kiriRoundOne, 'Damage +20% (total +20%)'));
  check('Genesis Kiri battle log shows a double-strike proc',
    hasEvent(kiriRoundOne, 'Double strike triggered')
    && hasEvent(kiriRoundOne, '*(Double!)*'));

  const moiraVsEvade = resolveBattle(
    player({ weaponPassiveKey: 'moira', weaponName: 'Moira', atk: 100, hp: 10_000, def: 0, crit: 0 }),
    mob({ skillKey: 'sigbin_shadow_step', atk: 0, hp: 10_000, def: 0 }),
    { mode: 'raid', rng: () => 0 },
  );
  check('Genesis Moira bypasses evasion without a false evade log',
    dmgOf(roundEvents(moiraVsEvade, 1), 'Hero attacks') > 0
    && !hasEvent(roundEvents(moiraVsEvade, 1), 'Shadow Step'));

  const moiraVsAbsorb = resolveBattle(
    player({ weaponPassiveKey: 'moira', weaponName: 'Moira', atk: 100, hp: 10_000, def: 0, crit: 0 }),
    player({
      name: 'Ironhide', weaponPassiveKey: 'gridr_iron_gloves',
      atk: 0, hp: 10_000, def: 0, crit: 0, classPassive: null,
    }),
    { mode: 'duel', rng: () => 0 },
  );
  check('Genesis Moira does not bypass absolute damage negation',
    dmgOf(roundEvents(moiraVsAbsorb, 1), 'Hero attacks') === 0
    && hasEvent(roundEvents(moiraVsAbsorb, 1), 'incoming hit ignored entirely')
    && !hasEvent(roundEvents(moiraVsAbsorb, 1), 'Enemy DEF reduced'));
}

// Explicit negative-effect metadata and category-scoped removal.
{
  const expectedStatus = [
    'stun', 'freeze', 'petrify', 'paralyze', 'thor_paralyze', 'dizzy', 'miss',
    'frostbite', 'charm', 'confuse', 'atk_down', 'def_down', 'crit_down',
    'hemorrhage', 'rupture',
  ];
  const expectedDots = ['bleed', 'burn', 'venom', 'poison', 'hp_pct_dot', 'thor_paralyze_dot'];
  check('all audited status IDs have explicit status metadata',
    expectedStatus.every((id) => effectCategory(id) === EFFECT_CATEGORY.STATUS));
  check('all audited DOT IDs have explicit DOT metadata',
    expectedDots.every((id) => effectCategory(id) === EFFECT_CATEGORY.DOT));
  check('ordinary Bleed carries the canonical bleed tag for Bloodhunter',
    effectHasTag('bleed', BLEED_TAG));
  check('every combat effect definition has a valid category',
    Object.values(EFFECT_DEFINITIONS).every((effect) =>
      effect.category === EFFECT_CATEGORY.STATUS || effect.category === EFFECT_CATEGORY.DOT));

  const statusOnly = [
    { tag: 'stun', category: EFFECT_CATEGORY.STATUS },
    { tag: 'burn', category: EFFECT_CATEGORY.DOT },
  ];
  const statusRemoved = removeEffectsByCategory(statusOnly, [EFFECT_CATEGORY.STATUS]);
  check('generic status cleanse removes Stun but not Burn',
    statusRemoved === 1 && statusOnly.length === 1 && statusOnly[0].tag === 'burn');

  const allDebuffs = [
    { tag: 'stun', category: EFFECT_CATEGORY.STATUS },
    { tag: 'burn', category: EFFECT_CATEGORY.DOT },
  ];
  const allRemoved = removeEffectsByCategory(
    allDebuffs,
    [EFFECT_CATEGORY.STATUS, EFFECT_CATEGORY.DOT],
  );
  check('all-debuff cleanse removes status and DOT effects',
    allRemoved === 2 && allDebuffs.length === 0);
}

// Juru Pakal must recognize the ordinary Bleed DOT visible in battle logs, not
// only Hemorrhage/Rupture/Venom markers.
{
  const sim = resolveBattle(
    player({
      name: 'JuruUser',
      class: 'Swordsman',
      classPassive: 'bleed',
      weaponPassiveKey: 'juru_pakal',
      atk: 100,
      hp: 10_000,
      def: 100,
      crit: 0,
    }),
    mob({ name: 'BleedingTarget', atk: 1, hp: 10_000, def: 0, crit: 0 }),
    { mode: 'raid', rng: () => 0.99 },
  );
  check('Juru Pakal logs Bloodhunter against an ordinary Bleed DOT',
    hasEvent(roundEvents(sim, 2), 'Bloodhunter — target is bleeding, +50% damage.'));
}

// Venom Rune is a landed-hit Poison DOT. If its victim acts first, it must not
// tick before the rune owner has actually landed an attack.
{
  const base = {
    classPassive: null,
    atk: 50,
    hp: 10_000,
    def: 0,
    crit: 0,
    effectRunes: [],
  };
  const sim = resolveBattle(
    player({ ...base, name: 'Faster' }),
    player({
      ...base,
      name: 'VenomUser',
      effectRunes: [{ effect_key: 'venom', value: 10 }],
    }),
    { mode: 'duel', rng: () => 0 },
  );
  const turn1 = roundEvents(sim, 1);
  const turn2 = roundEvents(sim, 2);
  const fasterAttack = turn2.findIndex((event) => event.includes('Faster attacks'));
  const poisonTick = turn2.findIndex((event) => event.includes('Faster suffers 5 Poison damage'));
  const venomAttack = turn2.findIndex((event) => event.includes('VenomUser attacks'));
  check('Venom does not damage the faster victim before the rune owner lands a hit',
    !hasEvent(turn1, 'Faster suffers') && !hasEvent(turn1, 'Poison damage'));
  check('Venom ticks as Poison after the afflicted fighter next acts',
    fasterAttack >= 0 && poisonTick > fasterAttack && venomAttack > poisonTick);
  check('Venom Rune description names Poison instead of generic DOT or Burn',
    runeDescription('venom', 10) === 'On hit: Poison 10% ATK/turn (2 turns)');
}

// Canonical and Echo deity keys share the same handler and immutable values.
{
  check('Echo Apolaki reuses the canonical handler',
    PASSIVE_REGISTRY.echo_apolaki === PASSIVE_REGISTRY.apolaki_solar_burn);
  check('Echo Surt reuses the canonical handler',
    PASSIVE_REGISTRY.echo_surt === PASSIVE_REGISTRY.surt_muspells_flame);
  check('Apolaki canonical values are centralized',
    Object.isFrozen(CANONICAL_ON_HIT_EFFECTS.apolaki)
      && CANONICAL_ON_HIT_EFFECTS.apolaki.atkPctPerHit === 0.10
      && CANONICAL_ON_HIT_EFFECTS.apolaki.turns === 1);
  check('Surt canonical values are centralized and capped',
    Object.isFrozen(CANONICAL_ON_HIT_EFFECTS.surt)
      && CANONICAL_ON_HIT_EFFECTS.surt.atkPctPerHit === 0.03
      && CANONICAL_ON_HIT_EFFECTS.surt.maxAtkPct === 0.15
      && CANONICAL_ON_HIT_EFFECTS.surt.turns === 2);

  for (const [name, canonicalKey, echoKey] of [
    ['Apolaki', 'apolaki_solar_burn', 'echo_apolaki'],
    ['Surt', 'surt_muspells_flame', 'echo_surt'],
  ]) {
    const canonical = resolveBattle(
      player({ atk: 100, hp: 10000, deityBlessingKey: canonicalKey }),
      mob({ atk: 10, hp: 5000 }),
      { mode: 'raid', seed: 919 },
    );
    const echo = resolveBattle(
      player({ atk: 100, hp: 10000, echoBlessingKey: echoKey }),
      mob({ atk: 10, hp: 5000 }),
      { mode: 'raid', seed: 919 },
    );
    check(`Echo ${name} battle behavior equals canonical behavior`,
      JSON.stringify(echo.rounds) === JSON.stringify(canonical.rounds)
        && JSON.stringify(echo.totals) === JSON.stringify(canonical.totals));
  }
}

// Enemy DOT passives snapshot the enemy's ATK at their corrected percentages.
{
  const applied = [];
  const bs = {
    currentTurn: 1,
    enemyATK: 200,
    playerStatusImmune: false,
    flags: {},
    log: [],
    rng: () => 0,
    applyPlayerDebuff(tag, turns, value) {
      applied.push({ tag, turns, value });
      return true;
    },
    onEnemyLandedHit(fn) {
      this.enemyLandedHitHook = fn;
    },
  };
  PASSIVE_REGISTRY.lamia_serpent_bite(bs);
  bs.enemyLandedHitHook();
  check('Lamia Serpent Bite uses 15% enemy ATK',
    applied.length === 1 && applied[0].tag === 'bleed'
      && applied[0].turns === 2 && applied[0].value === 30);

  applied.length = 0;
  bs.currentTurn = 3;
  PASSIVE_REGISTRY.chimera_tri_form_assault(bs);
  check('Chimera Serpent Phase uses 20% enemy ATK',
    applied.length === 1 && applied[0].tag === 'burn'
      && applied[0].turns === 2 && applied[0].value === 40);
}

// Attack-bound deity/echo effects and queued mob attacks do not resolve in the
// passive phase, and durable "next attack" effects survive a skipped action.
{
  const runPassive = (key, {
    currentTurn = 1,
    flags = {},
    playerWasCritted = false,
    rolls = [0],
  } = {}) => {
    const attackHooks = [];
    const landedHitHooks = [];
    const enemyAttackHooks = [];
    const enemyLandedHitHooks = [];
    let rollIndex = 0;
    flags.player_was_critted = playerWasCritted;
    const bs = {
      currentTurn,
      flags,
      playerAtkMult: 0,
      nextAttackDouble: false,
      rng: () => rolls[rollIndex++] ?? 0.99,
      enemyImmune: () => false,
      log: [],
      onAttack: (fn) => attackHooks.push(fn),
      onLandedHit: (fn) => landedHitHooks.push(fn),
      onEnemyAttack: (fn) => enemyAttackHooks.push(fn),
      onEnemyLandedHit: (fn) => enemyLandedHitHooks.push(fn),
    };
    PASSIVE_REGISTRY[key](bs);
    return {
      bs,
      attackHooks,
      landedHitHooks,
      enemyAttackHooks,
      enemyLandedHitHooks,
      rollsUsed: () => rollIndex,
    };
  };

  const zeus = runPassive('zeus_thunder_sovereign');
  check('Zeus does not roll or buff before an attack starts',
    zeus.rollsUsed() === 0 && zeus.bs.playerAtkMult === 0);
  zeus.attackHooks[0]();
  check('Zeus rolls and grants +50% on the actual attack',
    zeus.rollsUsed() === 1 && zeus.bs.playerAtkMult === 0.50);
  for (const hook of zeus.landedHitHooks) hook();
  check('Zeus applies one 5% shred stack only after the hit lands',
    zeus.bs.flags.zeus_def_shred_stacks === 1);

  const echoVidarFlags = {};
  runPassive('echo_vidar', {
    flags: echoVidarFlags,
    playerWasCritted: true,
  });
  const echoVidarNext = runPassive('echo_vidar', {
    currentTurn: 2,
    flags: echoVidarFlags,
  });
  check('Echo Vidar keeps its next-attack bonus queued through a skipped action',
    echoVidarFlags.echo_vidar_revenge_pending === true
      && echoVidarNext.bs.playerAtkMult === 0);
  echoVidarNext.attackHooks[0]();
  check('Echo Vidar consumes its queued +30% only when an attack starts',
    echoVidarNext.bs.playerAtkMult === 0.30
      && echoVidarFlags.echo_vidar_revenge_pending === false);

  const echoIdiyanaleFlags = {};
  runPassive('echo_idiyanale', {
    currentTurn: 6,
    flags: echoIdiyanaleFlags,
  });
  const echoIdiyanaleNext = runPassive('echo_idiyanale', {
    currentTurn: 7,
    flags: echoIdiyanaleFlags,
  });
  check('Echo Idiyanale keeps Double queued through a skipped sixth turn',
    echoIdiyanaleFlags.echo_idiyanale_double_pending === true
      && echoIdiyanaleNext.bs.nextAttackDouble === false);
  echoIdiyanaleNext.attackHooks[0]();
  check('Echo Idiyanale consumes Double only when the next attack starts',
    echoIdiyanaleNext.bs.nextAttackDouble === true
      && echoIdiyanaleFlags.echo_idiyanale_double_pending === false);

  const echoHabagat = runPassive('echo_habagat');
  check('Echo Habagat does not roll during the passive phase',
    echoHabagat.rollsUsed() === 0 && echoHabagat.bs.playerAtkMult === 0);
  echoHabagat.attackHooks[0]();
  check('Echo Habagat rolls on the actual attack',
    echoHabagat.rollsUsed() === 1 && echoHabagat.bs.playerAtkMult === 0.30);

  const nukeFlags = {};
  const nukeCadence = runPassive('amomongo_rend', {
    currentTurn: 3,
    flags: nukeFlags,
  });
  check('A cadence mob nuke is armed but does not fire before an attack starts',
    nukeFlags.enemy_nuke_pending === true
      && nukeFlags.enemy_atk_mult == null
      && nukeCadence.bs.log.length === 0);
  const nukeNext = runPassive('amomongo_rend', {
    currentTurn: 4,
    flags: nukeFlags,
  });
  nukeNext.enemyAttackHooks[0]();
  check('A cadence mob nuke survives a skipped cadence turn and fires on the next attack',
    nukeFlags.enemy_nuke_pending === false
      && nukeFlags.enemy_atk_mult === 1.50
      && hasEvent(nukeNext.bs.log, 'Amomongo: Rend'));
}

// — v5 uncapped CRIT / class stats —
{
  const archer = computeClassBattleStats('Archer', 50);
  check('R6: Archer Lv50 class crit = 39.3', Math.abs(archer.crit - 39.3) < 1e-9, `got ${archer.crit}`);
  const knight = computeClassBattleStats('Knight', 50);
  check('Knight crit stays 5.0 (0 growth)', Math.abs(knight.crit - 5.0) < 1e-9, `got ${knight.crit}`);
  // [v5] both the old class and combined CRIT ceilings are removed (§B.3).
  const tot = assemblePlayerStats('Archer', 50, { curr_atk: 0, crit: 10 }, null, null);
  check('v5 crit uncapped: Archer 39.3 + 10 weapon = 49.3', Math.abs(tot.crit - 49.3) < 1e-9, `got ${tot.crit}`);
  const archer60 = computeClassBattleStats('Archer', 60);
  check('v5 class crit continues beyond old 40% clamp', Math.abs(archer60.crit - 46.3) < 1e-9, `got ${archer60.crit}`);
  const mage = computeClassBattleStats('Mage', 50);
  check('Mage Lv50 ATK 7700', mage.atk === 350 + 150 * 49, `got ${mage.atk}`);
}

// — C1: mob formula base + per_level × level (live DB rows, v4.2 §15) —
{
  // 1e: fixtures pinned to the authoritative live mob_roster export ([Jun-2026 rebalance]).
  // Current raid scaling: regular 80/65/20; elite 90/75/25.
  // Formula is base + per_level × level (C1 — NOT level−1), so Lv1 reflects one level of growth.
  const blackDuwende = { base_hp: 2110, base_atk: 368, base_def: 178, base_crit: 5, hp_per_level: 80, atk_per_level: 65, def_per_level: 20 };
  const s1 = computeMobStats(blackDuwende, 1);
  check('C1: Black Duwende Lv1 = 2190/433/198', s1.hp === 2190 && s1.atk === 433 && s1.def === 198,
    `got hp=${s1.hp} atk=${s1.atk} def=${s1.def}`);
  // elite per-level 90/75/25
  const manananggal = { base_hp: 2950, base_atk: 422, base_def: 240, base_crit: 10, hp_per_level: 90, atk_per_level: 75, def_per_level: 25 };
  const e1 = computeMobStats(manananggal, 1);
  check('C1: Manananggal Lv1 = 3040/497/265', e1.hp === 3040 && e1.atk === 497 && e1.def === 265,
    `got hp=${e1.hp} atk=${e1.atk} def=${e1.def}`);
  // boss rows are authored per row (Medusa: 63500/1640/610, +315/+74/+27 per level).
  const boss = { base_hp: 63500, base_atk: 1640, base_def: 610, base_crit: 20, hp_per_level: 315, atk_per_level: 74, def_per_level: 27 };
  const s40 = computeMobStats(boss, 40);
  check('C1: boss Lv40 spot check', s40.hp === 76100 && s40.atk === 4600 && s40.def === 1690,
    `got hp=${s40.hp} atk=${s40.atk} def=${s40.def}`);
  const boss60 = computeBossStats(boss, 60);
  check('C1: boss stats stay fixed at authored base values',
    boss60.hp === 63500 && boss60.atk === 1640 && boss60.def === 610 && boss60.crit === 20,
    `got hp=${boss60.hp} atk=${boss60.atk} def=${boss60.def} crit=${boss60.crit}`);
  // [Progression v2] MOB_LEVEL_MAX rose 55 -> 120 with the player cap. Level 99 is now
  // BELOW the ceiling, so it scales normally; the clamp is asserted separately above it.
  const sUnclamped = computeMobStats(blackDuwende, 99);
  check('C1: mob level 99 scales without clamping', sUnclamped.hp === 2110 + 80 * 99, `got ${sUnclamped.hp}`);
  const sClamp = computeMobStats(blackDuwende, 999);
  check('C1: mob level clamped to MOB_LEVEL_MAX (120)', sClamp.hp === 2110 + 80 * 120, `got ${sClamp.hp}`);
}

// — [Jun-2026 §1] per-class distinct base + scaling (no uniform base anymore) —
{
  const L1_HP = { Swordsman: 700, Fighter: 850, Mage: 600, Knight: 1000, Archer: 600 };
  for (const cls of Object.keys(L1_HP)) {
    const s1 = computeClassBattleStats(cls, 1);
    check(`§1: ${cls} Lv1 HP = ${L1_HP[cls]}`, s1.hp === L1_HP[cls], `got ${s1.hp}`);
  }
  const L50_HP = { Swordsman: 8050, Fighter: 8200, Mage: 5500, Knight: 10800, Archer: 6725 };
  for (const cls of Object.keys(L50_HP)) {
    const stats = computeClassBattleStats(cls, 50);
    check(`§1: ${cls} Lv50 HP matches configured scaling`, stats.hp === L50_HP[cls], `got ${stats.hp}`);
  }
  // Swordsman/Archer reach 39.3 at L50; Knight stays flat at 5.0.
  check('§1: Swordsman Lv50 crit 39.3', Math.abs(computeClassBattleStats('Swordsman', 50).crit - 39.3) < 1e-9);
}

// — Katana ×2.30 vs base ×2.00 (forced crit, pinned variance) —
{
  // draws: order(0→A first), critPre(0→crit), variance(0.5→×1.0)
  const sK = resolveBattle(player({ weaponPassiveKey: 'katana' }), mob({ hp: 1 }),
    { seed: 1, rng: scripted([0.0, 0.0, 0.5]) });
  check('Knight katana crit includes ×1.30 class damage', dmgOf(allEvents(sK), 'attacks') === 640,
    `got ${dmgOf(allEvents(sK), 'attacks')}`);
  const sN = resolveBattle(player(), mob({ hp: 1 }),
    { seed: 1, rng: scripted([0.0, 0.0, 0.5]) });
  check('Knight base crit includes ×1.30 class damage', dmgOf(allEvents(sN), 'attacks') === 557,
    `got ${dmgOf(allEvents(sN), 'attacks')}`);
}

// — Unified Supreme damage bonus applies to both normal and critical hits. —
{
  // crit 0 weapon; Artemis grants the first-attack auto-crit (the "other source")
  const mk = () => player({ crit: 0, bonusDmgPct: 50, deityBlessingKey: 'artemis_huntress_precision' });
  // r1 draws: order 0, critPre .99 (no natural crit), variance .5; mob: crit .99, var .5; r2: critPre .99, var .5
  const sim = resolveBattle(mk(), mob({ hp: 10000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.5, 0.99, 0.5, 0.99, 0.5]) });
  const r1 = dmgOf(roundEvents(sim, 1), 'attacks');
  const r2 = dmgOf(roundEvents(sim, 2), 'attacks');
  // base hit ≈ 214; unified +50% means ×2.5 crit and ×1.5 non-crit.
  check('Supreme unified bonus: Knight crit hit', r1 === 696, `got ${r1}`);
  check('Supreme unified bonus: Knight non-crit hit', r2 === 417, `got ${r2}`);
  check('crit ≈ non-crit ÷1.5 ×2.5', Math.abs(r1 - Math.floor((r2 / 1.5) * 2.5)) <= 1, `got ${r1} vs ${Math.floor((r2 / 1.5) * 2.5)}`);
  check('round 1 marked CRIT', hasEvent(roundEvents(sim, 1), '(CRIT!)'));
  check('round 2 not marked CRIT', !hasEvent(roundEvents(sim, 2), '(CRIT!)'));
}

// — Idiyanale: every 3rd turn the attack deals +75% more damage via the effATK lane
//   (playerAtkMult). Isolated by comparing turn-3 damage WITH vs WITHOUT the blessing at
//   the same seed — turns 1–2 are identical, so the defender-stack state at turn 3 matches
//   and the only delta is the +75% effATK → i3 = 1.75 × a3. —
{
  const script = [0.0]; // order → A first
  for (let r = 0; r < 5; r++) script.push(0.99, 0.5, 0.99, 0.5); // critPre(no), Avar, mobCrit(no), mobVar
  const mk = (over) => resolveBattle(
    player({ crit: 0, hp: 1000000, ...over }),
    mob({ hp: 1000000, atk: 1, def: 0 }), { seed: 1, rng: scripted(script) });
  const baseline = mk({});
  const idi = mk({ deityBlessingKey: 'idiyanale_persistence' });
  const a1 = dmgOf(roundEvents(baseline, 1), 'attacks');
  const i1 = dmgOf(roundEvents(idi, 1), 'attacks');
  const a3 = dmgOf(roundEvents(baseline, 3), 'attacks');
  const i3 = dmgOf(roundEvents(idi, 3), 'attacks');
  check('Idiyanale fires on the 3rd turn', hasEvent(roundEvents(idi, 3), 'Idiyanale: Persistence'));
  check('Idiyanale does NOT fire on turn 5 (every-3 cadence)', !hasEvent(roundEvents(idi, 5), 'Idiyanale: Persistence'));
  check('Idiyanale leaves turn 1 unchanged (no rider yet)', i1 === a1, `idi ${i1} base ${a1}`);
  // Damage has a flat term on top of effATK, so the +75% effATK rider reads below ×1.75 in
  // final damage; assert it is clearly boosted vs the no-rider turn-3 hit.
  check('Idiyanale boosts turn 3 well above the no-rider hit', i3 > Math.round(a3 * 1.4), `idi ${i3} base ${a3}`);
}

// — [v4.4] Unified damage %: the weapon's durable bonusDmgPct and a procced source
//   (Katana +30 via scratch) STACK ADDITIVELY and apply to BOTH crit and non-crit.
//   50% + 30% = 80% → ×1.8 normal / ×2.8 crit. (No separate crit-damage stat.) —
{
  const mk = () => player({ bonusDmgPct: 50, weaponPassiveKey: 'katana' }); // 50 + 30 = 80%
  const sN = resolveBattle(mk(), mob({ hp: 100000 }), { seed: 1, rng: scripted([0.0, 0.99, 0.5, 0.99, 0.5]) });
  const sC = resolveBattle(mk(), mob({ hp: 100000 }), { seed: 1, rng: scripted([0.0, 0.0, 0.5, 0.99, 0.5]) });
  const n = dmgOf(roundEvents(sN, 1), 'attacks');
  const c = dmgOf(roundEvents(sC, 1), 'attacks');
  const sP = resolveBattle(player(), mob({ hp: 100000 }), { seed: 1, rng: scripted([0.0, 0.99, 0.5, 0.99, 0.5]) });
  const base = dmgOf(roundEvents(sP, 1), 'attacks'); // plain non-crit, no bonus
  check('damage% stack non-crit = base ×1.8', Math.abs(n - Math.floor(base * 1.8)) <= 1, `got ${n} vs ${Math.floor(base * 1.8)}`);
  check('damage% stack crit = base ×2.8', Math.abs(c - Math.floor(base * 2.8)) <= 1, `got ${c} vs ${Math.floor(base * 2.8)}`);
  check('round not crit-only: bonus applies to non-crit too', n > base, `n=${n} base=${base}`);
}

// — Knight DR ×0.75 (25% reduction) after mitigation, applied once, all modes —
{
  // order .9 → mob first; critPre(A) .99; mob crit .99, var .5; A var .5 (kills hp-1 mob)
  const script = [0.9, 0.99, 0.99, 0.5, 0.5];
  const sK = resolveBattle(player(), mob({ hp: 1 }), { seed: 1, rng: scripted(script) });
  // 57 post-DEF × 0.75 = 42.75 → floor 42 (DR floor 57×0.25=14.25 doesn't bind)
  check('Knight takes 42 (57 × 0.75)', dmgOf(allEvents(sK), 'strikes') === 42,
    `got ${dmgOf(allEvents(sK), 'strikes')}`);
  const sM = resolveBattle(player({ class: 'Mage', classPassive: 'overcharge' }), mob({ hp: 1 }),
    { seed: 1, rng: scripted(script) });
  check('non-Knight takes 57 (no DR)', dmgOf(allEvents(sM), 'strikes') === 57,
    `got ${dmgOf(allEvents(sM), 'strikes')}`);
  // reduction is applied exactly once: 42 = ⌊57×0.75⌋, not ⌊57×0.75²⌋=32
  check('Knight DR not double-applied', dmgOf(allEvents(sK), 'strikes') !== 32);
  // same 25% DR holds in every mode (shared resolveBattle, no per-mode damage path);
  // mob has enough HP to survive one turn and land its strike in every initiative order
  for (const mode of ['raid', 'boss', 'duel']) {
    const s = resolveBattle(player(), mob({ hp: 5000 }), { seed: 1, mode, rng: scripted(script) });
    check(`Knight DR = 42 in ${mode} mode`, dmgOf(allEvents(s), 'strikes') === 42,
      `${mode} got ${dmgOf(allEvents(s), 'strikes')}`);
  }
}

// — Archer pierce 25%, negated vs armor_pierce-immune —
{
  const mk = () => player({ class: 'Archer', classPassive: 'pierce' });
  const script = [0.0, 0.99, 0.5];
  const sPlain = resolveBattle(mk(), mob({ hp: 1 }), { seed: 1, rng: scripted(script) });
  check('Archer pierce: 230 vs DEF 80→60', dmgOf(allEvents(sPlain), 'attacks') === 230,
    `got ${dmgOf(allEvents(sPlain), 'attacks')}`);
  const sImm = resolveBattle(mk(), mob({ hp: 1, immunityTags: ['armor_pierce'] }),
    { seed: 1, rng: scripted(script) });
  check('Archer pierce blocked by immunity: 214', dmgOf(allEvents(sImm), 'attacks') === 214,
    `got ${dmgOf(allEvents(sImm), 'attacks')}`);
  const nonArcher = resolveBattle(
    player({ class: 'Mage', classPassive: 'overcharge' }),
    mob({ hp: 1 }),
    { seed: 1, rng: scripted(script) },
  );
  check('Archer DEF ignore is not granted to other classes',
    dmgOf(allEvents(nonArcher), 'attacks') === 214);
}

// — Archer Double Attack: a complete, independent, non-recursive attack instance. —
{
  const mkArcher = (over = {}) => player({
    class: 'Archer', classPassive: 'pierce', crit: 50,
    hp: 100000, def: 0, ...over,
  });
  const attackLines = (events) => events.filter((event) => event.includes('Hero attacks'));

  check('Archer Double Attack chance constant is exactly 25%',
    ARCHER_DOUBLE_ATTACK_CHANCE === 0.25);

  // Boss mode pins player-first and avoids an initiative draw:
  // crit-pre, attack-1 variance, Double Attack roll, attack-2 crit, attack-2 variance.
  const failed = resolveBattle(
    mkArcher({ crit: 0 }),
    mob({ hp: 100000, atk: 0 }),
    { mode: 'boss', rng: scripted([0.99, 0.5, 0.25], 0.5) },
  );
  check('Archer 25% boundary fails and produces one attack',
    attackLines(roundEvents(failed, 1)).length === 1
      && !hasEvent(roundEvents(failed, 1), 'Double Attack activated'));

  const normalThenCrit = resolveBattle(
    mkArcher(),
    mob({ hp: 100000, atk: 0 }),
    { mode: 'boss', rng: scripted([0.99, 0.5, 0.24, 0.0, 0.0], 0.5) },
  );
  const ntc = attackLines(roundEvents(normalThenCrit, 1));
  check('Archer proc produces exactly two separately logged attacks',
    ntc.length === 2 && hasEvent(roundEvents(normalThenCrit, 1), 'Double Attack activated'));
  check('Archer attack 2 independently varies and can crit when attack 1 does not',
    !ntc[0].includes('(CRIT!)') && ntc[1].includes('(CRIT!)')
      && dmgOf([ntc[0]], 'attacks') !== dmgOf([ntc[1]], 'attacks'));
  const activationAt = roundEvents(normalThenCrit, 1)
    .findIndex((event) => event.includes('Double Attack activated'));
  check('Archer activation log is ordered between attacks',
    roundEvents(normalThenCrit, 1).indexOf(ntc[0]) < activationAt
      && activationAt < roundEvents(normalThenCrit, 1).indexOf(ntc[1]));

  const critThenNormal = resolveBattle(
    mkArcher(),
    mob({ hp: 100000, atk: 0 }),
    { mode: 'boss', rng: scripted([0.0, 0.5, 0.24, 0.99, 0.5], 0.5) },
  );
  const ctn = attackLines(roundEvents(critThenNormal, 1));
  check('Archer attack 1 may crit while attack 2 does not',
    ctn[0].includes('(CRIT!)') && !ctn[1].includes('(CRIT!)'));

  const bothCrit = resolveBattle(
    mkArcher(),
    mob({ hp: 100000, atk: 0 }),
    { mode: 'boss', rng: scripted([0.0, 0.5, 0.24, 0.0, 0.5], 0.5) },
  );
  const both = attackLines(roundEvents(bothCrit, 1));
  check('both Archer attacks may independently crit',
    both.length === 2 && both.every((event) => event.includes('(CRIT!)')));

  const noRecursion = resolveBattle(
    mkArcher({ crit: 0 }),
    mob({ hp: 100000, atk: 0 }),
    { mode: 'boss', rng: () => 0 },
  );
  check('Archer class Double Attack cannot recurse',
    attackLines(roundEvents(noRecursion, 1)).length === 2
      && roundEvents(noRecursion, 1)
        .filter((event) => event.includes('Double Attack activated')).length === 1);

  let lethalDraws = 0;
  const lethalFirst = resolveBattle(
    mkArcher({ crit: 0 }),
    mob({ hp: 1, atk: 0 }),
    {
      mode: 'boss',
      rng: () => {
        lethalDraws += 1;
        return lethalDraws === 1 ? 0.99 : 0.5;
      },
    },
  );
  check('target death from Archer attack 1 prevents attack 2 and its proc roll',
    attackLines(roundEvents(lethalFirst, 1)).length === 1
      && !hasEvent(allEvents(lethalFirst), 'Double Attack activated')
      && lethalDraws === 2,
    `rng draws=${lethalDraws}`);

  const lethalSecond = resolveBattle(
    mkArcher({ crit: 0 }),
    mob({ hp: 300, atk: 0 }),
    { mode: 'boss', rng: scripted([0.99, 0.5, 0.24, 0.99, 0.5], 0.5) },
  );
  check('target death from Archer attack 2 ends combat normally',
    lethalSecond.winner === 'a'
      && lethalSecond.rounds.length === 1
      && attackLines(roundEvents(lethalSecond, 1)).length === 2);

  const vampiric = resolveBattle(
    mkArcher({
      crit: 0,
      hp: 1000,
      effectRunes: [{ effect_key: 'vampiric', value: 10 }],
    }),
    mob({
      hp: 100000, atk: 100, def: 0, crit: 0,
      specialFlags: { first_strike: true },
    }),
    {
      mode: 'raid',
      // crit-pre, mob crit/variance, attack-1 variance, class roll,
      // attack-2 crit/variance, then later fallback draws.
      rng: scripted([0.99, 0.99, 0.5, 0.5, 0.24, 0.99, 0.5], 0.5),
    },
  );
  check('both Archer attacks independently trigger Vampiric Rune Lifesteal',
    roundEvents(vampiric, 1)
      .filter((event) => event.includes('Vampiric Rune — healed')).length === 2,
    roundEvents(vampiric, 1).join(' | '));

  const thor = resolveBattle(
    mkArcher({ crit: 0, deityBlessingKey: 'thor_mjolnirs_wrath' }),
    mob({ hp: 100000, atk: 0 }),
    {
      mode: 'boss',
      // attack 1 Thor roll fails; class procs; attack 2 independently procs Thor.
      rng: scripted([0.99, 0.5, 0.99, 0.24, 0.99, 0.5, 0.0], 0.5),
    },
  );
  check('Archer attack 2 independently rolls eligible on-hit effects',
    roundEvents(thor, 1)
      .filter((event) => event.includes("Thor: Mjolnir's Wrath")).length === 1
      && roundEvents(thor, 1)
        .findIndex((event) => event.includes("Thor: Mjolnir's Wrath")) > roundEvents(thor, 1)
        .findIndex((event) => event.includes('Double Attack activated')),
    roundEvents(thor, 1).join(' | '));

  const freshEvade = resolveBattle(
    mkArcher({ crit: 0, specialFlags: { first_strike: true } }),
    player({
      name: 'Evader', classPassive: null, deityBlessingKey: 'amihan_tailwind',
      atk: 0, hp: 100000, def: 0, crit: 0,
    }),
    {
      mode: 'duel',
      // both crit pre-rolls; attack-1 Tailwind succeeds; attack-1 variance;
      // class procs; attack-2 Tailwind reroll fails; attack-2 crit/variance.
      rng: scripted([0.99, 0.99, 0.0, 0.5, 0.24, 0.99, 0.99, 0.5], 0.5),
    },
  );
  const evadeAttacks = attackLines(roundEvents(freshEvade, 1));
  check('Archer attack 2 receives a fresh independent evade roll',
    evadeAttacks.length === 2
      && evadeAttacks[0].includes('**Evaded!**')
      && !evadeAttacks[0].includes('0 DMG')
      && evadeAttacks[1].includes('DMG')
      && !evadeAttacks[1].includes('Evaded'),
    roundEvents(freshEvade, 1).join(' | '));

  const dotTiming = resolveBattle(
    mkArcher({ crit: 0, deityBlessingKey: 'surt_muspells_flame' }),
    mob({ hp: 100000, atk: 0 }),
    { mode: 'boss', rng: scripted([0.99, 0.5, 0.24, 0.99, 0.5], 0.5) },
  );
  check('Archer Double Attack stays in one round and DOT ticks only once',
    attackLines(roundEvents(dotTiming, 1)).length === 2
      && roundEvents(dotTiming, 1)
        .filter((event) => event.includes('suffers') && event.includes('Burn damage')).length === 1);

  for (const mode of ['raid', 'boss', 'duel']) {
    const opponent = mode === 'duel'
      ? player({ name: 'Rival', classPassive: null, atk: 0, hp: 100000, crit: 0 })
      : mob({ hp: 100000, atk: 0 });
    const sim = resolveBattle(
      mkArcher({ crit: 0, specialFlags: { first_strike: true } }),
      opponent,
      { mode, rng: () => 0 },
    );
    check(`Archer Double Attack uses shared resolver in ${mode}`,
      attackLines(roundEvents(sim, 1)).length === 2);
  }

  const N = 4000;
  let procs = 0;
  for (let seed = 1; seed <= N; seed += 1) {
    const sim = resolveBattle(
      mkArcher({ atk: 10, crit: 0 }),
      mob({ hp: 1_000_000, atk: 0, def: 0 }),
      { mode: 'boss', seed },
    );
    if (hasEvent(roundEvents(sim, 1), 'Double Attack activated')) procs += 1;
  }
  const procRate = procs / N;
  console.log(`   Archer proc-rate over ${N} battles (round 1): ${(procRate * 100).toFixed(1)}% (exp 25%)`);
  check('Archer Double Attack proc rate ≈ 25%',
    Math.abs(procRate - ARCHER_DOUBLE_ATTACK_CHANCE) < 0.03,
    `got ${(procRate * 100).toFixed(1)}%`);
}

// — Standardized primary/additional attack context and Labrys interactions. —
{
  const attackLines = (sim, round, name = 'Hero') => roundEvents(sim, round)
    .filter((event) => event.includes(`${name} attacks for **`));
  const base = (over = {}) => player({
    class: 'Test', classPassive: null, weaponPassiveKey: 'labrys',
    atk: 100, hp: 1_000_000, def: 0, crit: 0, ...over,
  });
  const target = (over = {}) => mob({
    hp: 10_000_000, atk: 0, def: 0, crit: 0, ...over,
  });

  const labrys = resolveBattle(base(), target(), { mode: 'boss', rng: () => 0.5 });
  check('Labrys turns 1 and 2 contain only the primary attack',
    attackLines(labrys, 1).length === 1 && attackLines(labrys, 2).length === 1);
  check('Labrys turn 3 contains primary + exactly one additional attack',
    attackLines(labrys, 3).length === 2
      && roundEvents(labrys, 3)
        .filter((event) => event.includes('Labrys: Double Strike activated')).length === 1);
  check('Labrys turn 6 repeats the same two-attack cadence',
    attackLines(labrys, 6).length === 2
      && roundEvents(labrys, 6)
        .filter((event) => event.includes('Labrys: Double Strike activated')).length === 1);
  check('Labrys preserves the existing 70% ATK additional strike',
    dmgOf([attackLines(labrys, 3)[0]], 'attacks') === 100
      && dmgOf([attackLines(labrys, 3)[1]], 'attacks') === 70);

  const labrysCrit = resolveBattle(
    base({ crit: 50 }),
    target(),
    {
      mode: 'boss',
      rng: scripted([
        0.99, 0.5, 0.99, 0.5,
        0.99, 0.5, 0.99, 0.5,
        0.99, 0.5, 0.00, 0.5, 0.99, 0.5,
      ], 0.5),
    },
  );
  const labrysCritR3 = attackLines(labrysCrit, 3);
  check('Labrys additional attack independently crits',
    !labrysCritR3[0].includes('(CRIT!)')
      && labrysCritR3[1].includes('(CRIT!)')
      && dmgOf([labrysCritR3[1]], 'attacks') === 140);

  const archerLabrysProc = resolveBattle(
    base({ class: 'Archer', classPassive: 'pierce' }),
    target(),
    { mode: 'boss', rng: () => 0 },
  );
  check('Archer alone has at most two attacks on a non-Labrys turn',
    attackLines(archerLabrysProc, 1).length === 2);
  check('Archer + Labrys has exactly three attacks on turn 3 when both proc',
    attackLines(archerLabrysProc, 3).length === 3);
  const comboEvents = roundEvents(archerLabrysProc, 3);
  const comboAttackIndexes = comboEvents
    .map((event, index) => event.includes('Hero attacks for **') ? index : -1)
    .filter((index) => index >= 0);
  const labrysAt = comboEvents.findIndex((event) => event.includes('Labrys: Double Strike activated'));
  const archerAt = comboEvents.findIndex((event) => event.includes("Hero's Double Attack activated"));
  check('combined proc order is primary → Labrys → Archer',
    comboAttackIndexes[0] < labrysAt
      && labrysAt < comboAttackIndexes[1]
      && comboAttackIndexes[1] < archerAt
      && archerAt < comboAttackIndexes[2],
    comboEvents.join(' | '));
  check('additional-attack generators cannot recurse',
    comboEvents.filter((event) => event.includes('Labrys: Double Strike activated')).length === 1
      && comboEvents.filter((event) => event.includes('Double Attack activated')).length === 1
      && attackLines(archerLabrysProc, 3).length === 3);

  const archerLabrysFail = resolveBattle(
    base({ class: 'Archer', classPassive: 'pierce' }),
    target(),
    { mode: 'boss', rng: () => 0.5 },
  );
  check('Labrys turn has exactly two attacks when Archer does not proc',
    attackLines(archerLabrysFail, 3).length === 2
      && !hasEvent(roundEvents(archerLabrysFail, 3), 'Double Attack activated'));

  const primaryKill = resolveBattle(
    base({ class: 'Archer', classPassive: 'pierce' }),
    target({ hp: 250 }),
    {
      mode: 'boss',
      rng: scripted([
        0.99, 0.5, 0.99, 0.99, 0.5,
        0.99, 0.5, 0.99, 0.99, 0.5,
        0.99, 0.5,
      ], 0.5),
    },
  );
  check('primary kill prevents every queued additional attack',
    attackLines(primaryKill, 3).length === 1
      && !hasEvent(roundEvents(primaryKill, 3), 'Labrys: Double Strike activated')
      && !hasEvent(roundEvents(primaryKill, 3), 'Double Attack activated'));

  const labrysKill = resolveBattle(
    base({ class: 'Archer', classPassive: 'pierce' }),
    target({ hp: 350 }),
    {
      mode: 'boss',
      rng: scripted([
        0.99, 0.5, 0.99, 0.99, 0.5,
        0.99, 0.5, 0.99, 0.99, 0.5,
        0.99, 0.5, 0.00, 0.99, 0.5,
      ], 0.5),
    },
  );
  check('Labrys kill prevents the queued Archer attack',
    labrysKill.winner === 'a'
      && attackLines(labrysKill, 3).length === 2
      && hasEvent(roundEvents(labrysKill, 3), 'Labrys: Double Strike activated')
      && !hasEvent(roundEvents(labrysKill, 3), 'Double Attack activated'));

  const swordsmanLabrys = resolveBattle(
    base({ class: 'Swordsman', classPassive: 'bleed' }),
    target(),
    { mode: 'boss', rng: () => 0.5 },
  );
  check('Swordsman Labrys attack independently adds a second 4% Bleed stack',
    hasEvent(roundEvents(swordsmanLabrys, 2), 'suffers 8 Bleed damage')
      && hasEvent(roundEvents(swordsmanLabrys, 3), 'suffers 16 Bleed damage'));

  const fighterAdditional = resolveBattle(
    base({ class: 'Fighter', classPassive: 'stun' }),
    target(),
    {
      mode: 'boss',
      rng: scripted([
        0.99, 0.99, 0.5, 0.99, 0.5,
        0.99, 0.99, 0.5, 0.99, 0.5,
        0.99, 0.99, 0.5, 0.00, 0.99, 0.5, 0.99, 0.5,
      ], 0.5),
    },
  );
  const fighterR3 = roundEvents(fighterAdditional, 3);
  const fighterR3Attacks = attackLines(fighterAdditional, 3);
  check('Fighter Labrys attack gets an independent 25% Stun/Bash roll',
    fighterR3Attacks.length === 2
      && !fighterR3Attacks[0].includes('(CRIT!)')
      && hasEvent(fighterR3, 'blow stuns Dummy for 1 turn')
      && hasEvent(fighterR3, 'becomes Dizzy and is stunned for 1 turn'));
  const fighterBash = dmgOf(fighterR3, 'follows with Bash');
  check('Fighter Labrys Bash deals 100% of its triggering 70% strike',
    dmgOf([fighterR3Attacks[1]], 'attacks') === 70 && fighterBash === 70,
    `attack=${dmgOf([fighterR3Attacks[1]], 'attacks')} bash=${fighterBash}`);
  check('Fighter Labrys Stun skips exactly one eligible action',
    hasEvent(roundEvents(fighterAdditional, 4), 'unable to act (Dizzy, stun)')
      && hasEvent(roundEvents(fighterAdditional, 5), 'Dummy strikes'));

  const fighterBothRoll = resolveBattle(
    base({ class: 'Fighter', classPassive: 'stun' }),
    target(),
    {
      mode: 'boss',
      rng: scripted([
        0.99, 0.99, 0.5, 0.99, 0.5,
        0.99, 0.99, 0.5, 0.99, 0.5,
        0.99, 0.00, 0.5, 0.00, 0.99, 0.5, 0.99, 0.5,
      ], 0.5),
    },
  );
  check('two successful Fighter rolls in one turn cannot extend Stun',
    roundEvents(fighterBothRoll, 3)
      .filter((event) => event.includes('blow stuns')).length === 1
      && roundEvents(fighterBothRoll, 3)
        .filter((event) => event.includes('follows with Bash')).length === 1
      && hasEvent(roundEvents(fighterBothRoll, 4), 'unable to act')
      && hasEvent(roundEvents(fighterBothRoll, 5), 'Dummy strikes'));

  const knightLabrys = resolveBattle(
    base({ class: 'Knight', classPassive: 'damage_reduction' }),
    target(),
    { mode: 'boss', rng: () => 0.5 },
  );
  const knightR3 = attackLines(knightLabrys, 3);
  check('Knight +30% offense is applied once inside each Labrys attack calculation',
    dmgOf([knightR3[0]], 'attacks') === 130
      && dmgOf([knightR3[1]], 'attacks') === 91);

  const mageLabrys = resolveBattle(
    base({ class: 'Mage', classPassive: 'overcharge' }),
    target(),
    { mode: 'boss', rng: () => 0.5 },
  );
  for (const round of [3, 6]) {
    const attacks = attackLines(mageLabrys, round);
    check(`Mage + Labrys round ${round}: primary is ×2.75 and Labrys stays normal`,
      attacks.length === 2
        && dmgOf([attacks[0]], 'attacks') === 275
        && attacks[0].includes('(Overcharge!)')
        && dmgOf([attacks[1]], 'attacks') === 70
        && !attacks[1].includes('(Overcharge!)'));
    check(`Mage Overcharge activates only once on round ${round}`,
      roundEvents(mageLabrys, round)
        .filter((event) => event.includes('Charge 3/3 — Released!')).length === 1);
  }

  const mageLabrysCrit = resolveBattle(
    base({ class: 'Mage', classPassive: 'overcharge', crit: 50 }),
    target(),
    {
      mode: 'boss',
      rng: scripted([
        0.99, 0.5, 0.99, 0.5,
        0.99, 0.5, 0.99, 0.5,
        0.00, 0.5, 0.00, 0.5, 0.99, 0.5,
      ], 0.5),
    },
  );
  const mageCritR3 = attackLines(mageLabrysCrit, 3);
  check('Mage Labrys strike can independently crit without inheriting Overcharge',
    mageCritR3[0].includes('(Overcharge!)')
      && !mageCritR3[0].includes('(CRIT!)')
      && mageCritR3[1].includes('(CRIT!)')
      && !mageCritR3[1].includes('(Overcharge!)')
      && dmgOf([mageCritR3[1]], 'attacks') === 140);

  const mageLifesteal = resolveBattle(
    base({
      class: 'Mage', classPassive: 'overcharge', hp: 1000,
      effectRunes: [{ effect_key: 'vampiric', value: 10 }],
    }),
    target({ atk: 100 }),
    { mode: 'boss', rng: () => 0.5 },
  );
  const mageLifeR3 = roundEvents(mageLifesteal, 3)
    .filter((event) => event.includes('Vampiric Rune — healed'));
  check('Mage primary and Labrys attacks calculate Lifesteal independently',
    mageLifeR3.length === 2
      && mageLifeR3.some((event) => event.includes('healed 27 HP'))
      && mageLifeR3.some((event) => event.includes('healed 7 HP')),
    mageLifeR3.join(' | '));

  const magePrimaryKill = resolveBattle(
    base({ class: 'Mage', classPassive: 'overcharge' }),
    target({ hp: 400 }),
    { mode: 'boss', rng: () => 0.5 },
  );
  check('Overcharged primary kill prevents Mage Labrys attack',
    magePrimaryKill.winner === 'a'
      && attackLines(magePrimaryKill, 3).length === 1
      && !hasEvent(roundEvents(magePrimaryKill, 3), 'Labrys: Double Strike activated'));

  const glacialArcher = resolveBattle(
    base({
      class: 'Archer', classPassive: 'pierce',
      weaponPassiveKey: 'scandinavian_glacial_wooden_bow',
    }),
    target(),
    { mode: 'boss', rng: () => 0 },
  );
  check('all additional-attack generators share the same no-recursion context',
    attackLines(glacialArcher, 1).length === 3
      && roundEvents(glacialArcher, 1)
        .filter((event) => event.includes('Frostwind Volley activated')).length === 1
      && roundEvents(glacialArcher, 1)
        .filter((event) => event.includes('Double Attack activated')).length === 1);

  const mjolnirArcher = resolveBattle(
    base({
      class: 'Archer', classPassive: 'pierce',
      weaponPassiveKey: 'mjolnir',
    }),
    target(),
    { mode: 'boss', rng: () => 0 },
  );
  const mjolnirR3 = attackLines(mjolnirArcher, 3);
  check('turn-based Mjolnir crush applies only to the primary attack',
    mjolnirR3.length === 2
      && dmgOf([mjolnirR3[0]], 'attacks') === 297
      && dmgOf([mjolnirR3[1]], 'attacks') === 117
      && roundEvents(mjolnirArcher, 3)
        .filter((event) => event.includes('CRUSH!')).length === 1);

  const turnSafety = resolveBattle(
    base({ class: 'Archer', classPassive: 'pierce', atk: 0 }),
    target({ atk: 0 }),
    { mode: 'boss', rng: () => 0 },
  );
  check('turn-30 additional attacks do not repeat sudden-death processing',
    attackLines(turnSafety, 30).length === 3
      && roundEvents(turnSafety, 30)
        .filter((event) => event.includes('Sudden death!')).length === 1);
}

// — Swordsman bleed 4%/stack, capped at 20% ATK (5 stacks) —
{
  // bleed tick value = stacks × 0.04 × attacker ATK; ATK 300 → cap = 5 × 0.04 × 300 = 60.
  const ATK = 300;
  const BLEED_CAP_TICK = Math.floor(0.20 * ATK); // 60
  check('Swordsman constants are 4% per hit and 20% maximum',
    BLEED_PCT_PER_STACK === 0.04
      && BLEED_MAX_PCT === 0.20
      && BLEED_MAX_STACKS === 5);
  const sword = () => player({ class: 'Swordsman', classPassive: 'bleed', atk: ATK });
  const sim = resolveBattle(sword(), mob({ hp: 500_000, atk: 40, def: 40 }), { seed: 3 });
  const bleedTicksPerRound = sim.rounds.map(
    (r) => r.events
      .map((e) => /suffers (\d+) Bleed damage/.exec(e))
      .filter(Boolean)
      .map((m) => Number(m[1]))
  );
  const allTicks = bleedTicksPerRound.flat();
  check('bleed actually ticks', allTicks.length > 0, `ticks: ${allTicks.length}`);
  // 4%/stack: first stack ticks floor(0.04×300) = 12.
  check('bleed first tick = 12 (4% ATK)', allTicks.includes(12), `ticks: ${allTicks.slice(0, 8)}`);
  check('bleed second successful attack accumulates to 8% ATK',
    allTicks.includes(24), `ticks: ${allTicks.slice(0, 8)}`);
  // cap holds under repeated applications: reaches exactly 60, never exceeds.
  check('bleed reaches 20% cap (60)', Math.max(...allTicks) === BLEED_CAP_TICK,
    `max ${Math.max(...allTicks)}`);
  check('bleed never exceeds 20% cap', allTicks.every((t) => t <= BLEED_CAP_TICK),
    `max ${Math.max(...allTicks)}`);
  check('old 30% Bleed cap is unreachable', !allTicks.includes(Math.floor(0.30 * ATK)));
  // one bleed tick per turn — never double-ticked in a single round
  check('bleed ticks at most once per turn', bleedTicksPerRound.every((r) => r.length <= 1),
    `max/round ${Math.max(...bleedTicksPerRound.map((r) => r.length))}`);
  // other classes never get the Swordsman bleed passive
  const knightSim = resolveBattle(player({ class: 'Knight', classPassive: 'damage_reduction', atk: ATK }),
    mob({ hp: 500_000, atk: 40, def: 40 }), { seed: 3 });
  check('non-Swordsman deals no class bleed', !hasEvent(allEvents(knightSim), 'Bleed'));

  const critBleed = resolveBattle(
    sword(),
    mob({ hp: 500_000, atk: 0, def: 40 }),
    { mode: 'boss', rng: scripted([0.0, 0.5], 0.5) },
  );
  check('a critical hit still applies only one 4% Bleed stack',
    hasEvent(roundEvents(critBleed, 1), 'suffers 12 Bleed damage')
      && !hasEvent(roundEvents(critBleed, 1), 'suffers 24 Bleed damage'));

  const multiHitBleed = resolveBattle(
    player({
      class: 'Swordsman', classPassive: 'bleed', atk: ATK,
      weaponPassiveKey: 'labrys',
    }),
    mob({ hp: 500_000, atk: 0, def: 40 }),
    { mode: 'boss', rng: () => 0 },
  );
  const multiHitTicks = allEvents(multiHitBleed)
    .map((event) => /suffers (\d+) Bleed damage/.exec(event))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  check('multi-hit attacks cannot bypass the 20% Bleed cap',
    multiHitTicks.length > 0
      && Math.max(...multiHitTicks) === BLEED_CAP_TICK
      && multiHitTicks.every((tick) => tick <= BLEED_CAP_TICK),
    `max=${Math.max(...multiHitTicks)}`);
}

// — Mage Overcharge: fires rounds 3/6/9, fixed ×2.75, crit suppressed —
{
  const mk = () => player({ class: 'Mage', classPassive: 'overcharge' });
  // raid draws/round: critPre, playerVar, mobCrit, mobVar. Round 3 = overcharge; its
  // crit pre-roll is forced to 0.0 (would crit) to prove the crit is voided anyway.
  const script = [0.0, /* r1 */ 0.99, 0.5, 0.99, 0.5, /* r2 */ 0.99, 0.5, 0.99, 0.5,
    /* r3 */ 0.0, 0.5, 0.99, 0.5];
  const sim = resolveBattle(mk(), mob({ hp: 100000 }), { seed: 1, rng: scripted(script) });
  // ×2.75 fixed base multiplier (no crit, no rider) → exact pipeline result 589.
  check('Overcharge fires round 3 = 589 (×2.75)', dmgOf(roundEvents(sim, 3), 'attacks') === 589,
    `got ${dmgOf(roundEvents(sim, 3), 'attacks')}`);
  check('Overcharge release marker on round 3', hasEvent(roundEvents(sim, 3), 'Charge 3/3 — Released!'));
  check('Overcharge charges on rounds 1/2',
    hasEvent(roundEvents(sim, 1), 'Charge 1/3') && hasEvent(roundEvents(sim, 2), 'Charge 2/3'));
  for (const round of [1, 2, 3]) {
    const events = roundEvents(sim, round);
    const chargeAt = events.findIndex((event) => event.includes(`Charge ${round}/3`));
    const attackAt = events.findIndex((event) => event.includes('attacks'));
    check(`Overcharge charge precedes the Mage attack on round ${round}`,
      chargeAt >= 0 && attackAt > chargeAt, `charge@${chargeAt} attack@${attackAt}`);
  }
  // BUG FIX: the crit pre-roll succeeds (0.0) on round 3 yet the hit must NOT crit
  check('Overcharge round 3 never crits (pre-roll latch voided)', !hasEvent(roundEvents(sim, 3), '(CRIT!)'));
  check('round 1/2 are plain hits = 214', dmgOf(roundEvents(sim, 1), 'attacks') === 214 && dmgOf(roundEvents(sim, 2), 'attacks') === 214,
    `r1=${dmgOf(roundEvents(sim, 1), 'attacks')} r2=${dmgOf(roundEvents(sim, 2), 'attacks')}`);
  check('Overcharge uses the exact ×2.75 base multiplier',
    dmgOf(roundEvents(sim, 3), 'attacks')
      === Math.floor(300 * (1 - 80 / (80 + 200)) * 2.75));
}

// — Overcharge re-fires every 3rd round (fallback-driven; not 4/5) —
{
  const mk = () => player({ class: 'Mage', classPassive: 'overcharge', hp: 1000000 });
  const sim = resolveBattle(mk(), mob({ hp: 1000000, atk: 1 }), { seed: 1, rng: scripted([0.0]) });
  check('Overcharge re-fires round 6', hasEvent(roundEvents(sim, 6), 'Charge 3/3 — Released!'));
  check('Overcharge re-fires round 9', hasEvent(roundEvents(sim, 9), 'Charge 3/3 — Released!'));
  check('Overcharge cycle resets after each release',
    hasEvent(roundEvents(sim, 4), 'Charge 1/3') && hasEvent(roundEvents(sim, 5), 'Charge 2/3')
    && hasEvent(roundEvents(sim, 7), 'Charge 1/3') && hasEvent(roundEvents(sim, 8), 'Charge 2/3'));
}

// — [Jun-2026 §2] Overcharge lost when skip-CC GATES round 3 (CC procs round 2, gates the
//   NEXT turn); a proc on the overcharge round itself does NOT cancel that round. —
{
  // Santelmo applies a 1-turn skip on its proc; script the proc to land on round 2 so the
  // gate falls on round 3 (the overcharge round). draws/round (Mage + santelmo mob):
  // critPre, santelmoProc, playerVar, mobCrit, mobVar (a skipped round drops playerVar).
  const mk = () => player({ class: 'Mage', classPassive: 'overcharge', hp: 100000 });
  const script = [0.0,
    /* r1 */ 0.99, 0.99, 0.5, 0.99, 0.5,
    /* r2 */ 0.99, 0.01, 0.5, 0.99, 0.5,       // santelmo procs → gates player's r3
    /* r3 */ 0.99, 0.99, 0.99, 0.5,            // player skipped (no playerVar this round)
    /* r4 */ 0.99, 0.99, 0.5, 0.99, 0.5,
    /* r5 */ 0.99, 0.99, 0.5, 0.99, 0.5,
    /* r6 */ 0.99, 0.99, 0.5, 0.99, 0.5];
  const sim = resolveBattle(mk(), mob({ hp: 100000, skillKey: 'santelmo_will_o_wisp' }),
    { seed: 1, rng: scripted(script) });
  check('directional: player ACTS round 2 (the CC proc round)', hasEvent(roundEvents(sim, 2), 'attacks'));
  check('skip-CC gates round 3: player unable to act', hasEvent(roundEvents(sim, 3), 'unable to act'));
  check('skip-CC on round 3: overcharge lost (no charge/release log, no attack)',
    !hasEvent(roundEvents(sim, 3), 'Mage Passive: Overcharge') && !hasEvent(roundEvents(sim, 3), 'attacks'));
  check('skip-CC: no carry-over to round 4', hasEvent(roundEvents(sim, 4), 'Charge 1/3'));
  check('skip-CC: next overcharge fires round 6', hasEvent(roundEvents(sim, 6), 'Charge 3/3 — Released!'));
}

// — Overcharge suppresses crit even vs an auto-crit grant (Apollo round 12) —
{
  // Apollo grants a guaranteed crit every 3rd ATTACK TURN (not every 4th round — the
  // counter is attack-bound, so a skipped turn does not burn a count). With an attack
  // every round, attack turn N == round N, so crits land on rounds 3, 6, 9, 12.
  // Every one of those is ALSO an overcharge round (N % 3 == 0), which is precisely why
  // this pairing is worth asserting: suppression must win on all of them.
  // Fallback 0.5 means no NATURAL crits (crit 20 vs pre-roll 50).
  const mk = () => player({ class: 'Mage', classPassive: 'overcharge', weaponPassiveKey: 'apollos_silver_bow', hp: 1000000 });
  const sim = resolveBattle(mk(), mob({ hp: 1000000, atk: 1 }), { seed: 1, rng: scripted([0.0]) });
  check('Apollo auto-crit suppressed by overcharge on round 3', !hasEvent(roundEvents(sim, 3), '(CRIT!)'));
  check('Apollo auto-crit suppressed by overcharge on round 6', !hasEvent(roundEvents(sim, 6), '(CRIT!)'));
  check('Apollo grants no crit on non-Apollo rounds', !hasEvent(roundEvents(sim, 4), '(CRIT!)') && !hasEvent(roundEvents(sim, 5), '(CRIT!)'));

  // Same weapon on a class WITHOUT overcharge: the crit actually lands, on the 3rd,
  // 6th and 9th attack turns.
  const plain = resolveBattle(
    player({ classPassive: null, weaponPassiveKey: 'apollos_silver_bow', hp: 1000000 }),
    mob({ hp: 1000000, atk: 1 }),
    { seed: 1, rng: scripted([0.5]) },
  );
  check('Apollo auto-crit lands on attack turn 3', hasEvent(roundEvents(plain, 3), '(CRIT!)'));
  check('Apollo auto-crit lands on attack turn 6', hasEvent(roundEvents(plain, 6), '(CRIT!)'));
  check('Apollo does not crit on attack turns 4 and 5',
    !hasEvent(roundEvents(plain, 4), '(CRIT!)') && !hasEvent(roundEvents(plain, 5), '(CRIT!)'));
  check('Overcharge round 12 fires', hasEvent(roundEvents(sim, 12), 'Charge 3/3 — Released!'));
  check('Overcharge suppresses the auto-crit on round 12', !hasEvent(roundEvents(sim, 12), '(CRIT!)'));
}

// — [v4.2] boss mode: player ALWAYS acts first; no order draw consumed —
{
  // first draw 0.0 feeds the round-1 crit pre-roll (NOT an order roll) → guaranteed crit,
  // proving the order draw is skipped. If a draw had been consumed, crit pre-roll would
  // read 0.5 (no crit). Player still leads the round.
  const sim = resolveBattle(player(), mob({ hp: 100000, mobType: 'boss' }),
    { mode: 'boss', seed: 1, rng: scripted([0.0, 0.5, 0.99, 0.5]) });
  const ev = roundEvents(sim, 1);
  const iPlayer = ev.findIndex((e) => e.includes('attacks'));
  const iMob = ev.findIndex((e) => e.includes('strikes'));
  check('boss mode: player acts first', iPlayer !== -1 && iMob !== -1 && iPlayer < iMob, `player@${iPlayer} mob@${iMob}`);
  check('boss mode: no order draw (first draw = crit pre-roll → CRIT)', hasEvent(ev, '(CRIT!)'));
  // Sleipnir first_strike still overrides → boss first even in boss mode.
  const simS = resolveBattle(player(), mob({ hp: 100000, mobType: 'boss', specialFlags: { first_strike: true } }),
    { mode: 'boss', seed: 1, rng: scripted([0.99, 0.99, 0.5, 0.5]) });
  const evS = roundEvents(simS, 1);
  const iMobS = evS.findIndex((e) => e.includes('strikes'));
  const iPlayerS = evS.findIndex((e) => e.includes('attacks'));
  check('boss mode: Sleipnir first_strike overrides (boss first)', iMobS !== -1 && iPlayerS !== -1 && iMobS < iPlayerS,
    `mob@${iMobS} player@${iPlayerS}`);
}

// — [v4.8] snapshot cadence per mode (raid + duel on rounds 1,4,16,… / boss every 3rd) —
{
  // atk 0 both sides → no early kill; runs well past round 16 (sudden death starts round 30).
  const inLoop = (sim) => new Set(sim.snapshots.filter((s) => !s.tag).map((s) => s.round));
  const duel = inLoop(resolveBattle(player({ atk: 0, hp: 5000 }), player({ name: 'R', atk: 0, hp: 5000 }), { mode: 'duel', seed: 5 }));
  check('snapshot duel: rounds 1,4,16 present; 2,3,5 absent', duel.has(1) && duel.has(4) && duel.has(16) && !duel.has(2) && !duel.has(3) && !duel.has(5), [...duel].join(','));
  const raid = inLoop(resolveBattle(player({ atk: 0, hp: 5000 }), mob({ atk: 0, hp: 5000 }), { mode: 'raid', seed: 5 }));
  check('snapshot raid: rounds 1,4,16 present; 2,3,5 absent', raid.has(1) && raid.has(4) && raid.has(16) && !raid.has(2) && !raid.has(3) && !raid.has(5), [...raid].join(','));
  const boss = inLoop(resolveBattle(player({ atk: 0, hp: 5000 }), mob({ atk: 0, hp: 5000, mobType: 'boss' }), { mode: 'boss', seed: 5 }));
  check('snapshot boss: every 3rd (3,6 present; 1,2,4 absent)', boss.has(3) && boss.has(6) && !boss.has(1) && !boss.has(2) && !boss.has(4), [...boss].join(','));
}

// — Layout renderer snapshot actions: current move, actual damage, and new debuffs. —
{
  const sim = resolveBattle(
    player({ class: 'Mage', classPassive: 'overcharge', weaponName: 'Hunting Bow' }),
    mob({
      name: 'Amalanhig', skillKey: 'amalanhig_infectious_bite',
      skillName: 'Infectious Bite', skillDescription: '30% Rot for 2 turns', hp: 100000,
    }),
    { mode: 'raid', seed: 1, rng: () => 0.1 }
  );
  const action = sim.snapshots.find((s) => s.round === 1)?.actions;
  check('snapshot actions: weapon move title', action?.a.title === 'Casts Arrow Volley', action?.a.title);
  check('snapshot actions: actual damage included', /HP to Amalanhig/.test(action?.a.detail || ''), action?.a.detail);
  check('snapshot actions: landed-hit mob debuff duration included',
    action?.b.title === 'Infectious Bite' && /Rot inflicted \(2 turns\)/.test(action?.b.detail || ''),
    `${action?.b.title} / ${action?.b.detail}`);
}

// An on-hit mob DOT cannot proc before the mob lands its attack. Once applied, it
// ticks after the affected side's next action.
{
  const sim = resolveBattle(
    player({ name: 'TestUser', hp: 50, def: 100000, atk: 1, crit: 0 }),
    mob({
      name: 'Lamia',
      atk: 400,
      skillKey: 'lamia_serpent_bite',
      hp: 3000,
      specialFlags: { first_strike: true },
    }),
    { mode: 'raid', rng: () => 0 }
  );
  const ev = roundEvents(sim, 1);
  const iAttack = ev.findIndex((e) => e.includes('TestUser attacks'));
  const iBleed = ev.findIndex((e) => e.includes('TestUser suffers 50 Bleed damage'));
  const iDeath = ev.findIndex((e) => e.includes('TestUser was defeated by Bleed'));
  const iMob = ev.findIndex((e) => e.includes('Lamia strikes'));
  const iProc = ev.findIndex((e) => e.includes('Lamia: Serpent Bite'));
  check('on-hit DOT procs after mob strike and ticks after the affected action',
    sim.winner === 'b' && sim.outcome === 'dot'
      && iMob !== -1 && iMob < iProc && iProc < iAttack && iAttack < iBleed && iBleed < iDeath,
    `winner=${sim.winner} outcome=${sim.outcome} events=${ev.join(' | ')}`);
}

// Passive log display follows the owner: actor 2's weapon/deity logs must appear
// after actor 2's attack, not between actor 1 and actor 2.
{
  const sim = resolveBattle(
    player({ name: 'First', weaponPassiveKey: 'arrow_of_eros', atk: 20, hp: 100000, def: 0, crit: 0 }),
    player({ name: 'Second', weaponPassiveKey: 'arrow_of_eros', atk: 20, hp: 100000, def: 0, crit: 0 }),
    { mode: 'duel', rng: () => 0 }
  );
  const ev = roundEvents(sim, 1);
  const firstAttack = ev.findIndex((e) => e.includes('First attacks'));
  const secondAttack = ev.findIndex((e) => e.includes('Second attacks'));
  const arrows = ev.map((e, i) => e.includes('Arrow of Eros') ? i : -1).filter((i) => i >= 0);
  check('passive logs render after their owner attack',
    arrows.length >= 2 && firstAttack < arrows[0] && arrows[0] < secondAttack && secondAttack < arrows[1],
    ev.join(' | '));
}

// Reactive armor/defender effects display after the hit that triggered them.
{
  const sim = resolveBattle(
    player({ name: 'First', classPassive: null, atk: 50, hp: 100000, def: 0, crit: 0 }),
    player({
      name: 'Second',
      classPassive: null,
      armorPassiveKey: 'shield_of_the_valkyrie',
      atk: 50,
      hp: 100000,
      def: 0,
      crit: 0,
    }),
    { mode: 'duel', rng: () => 0 },
  );
  const ev = roundEvents(sim, 1);
  const firstAttack = ev.findIndex((event) => event.includes('First attacks'));
  const resolveBuff = ev.findIndex((event) => event.includes("Valkyrie's Resolve"));
  const secondAttack = ev.findIndex((event) => event.includes('Second attacks'));
  check('reactive armor buff renders after the triggering attack',
    firstAttack >= 0 && resolveBuff > firstAttack && secondAttack > resolveBuff,
    ev.join(' | '));
}

// Representative chance-block armor and Thorns Rune reactions also belong to
// the incoming attack, never to the defender's passive setup or later action.
{
  const armor = resolveBattle(
    player({ name: 'ArmorAttacker', classPassive: null, atk: 50, hp: 100000, def: 0, crit: 0 }),
    player({
      name: 'ArmorDefender', classPassive: null, armorPassiveKey: 'steel_kite_shield',
      atk: 50, hp: 100000, def: 0, crit: 0,
    }),
    { mode: 'duel', rng: () => 0 },
  );
  const armorEvents = roundEvents(armor, 1);
  const armorAttack = armorEvents.findIndex((event) => event.includes('ArmorAttacker attacks'));
  const armorBlock = armorEvents.findIndex((event) => event.includes('Steel Kite Shield: Bulwark'));
  const defenderAttack = armorEvents.findIndex((event) => event.includes('ArmorDefender attacks'));
  check('chance-block armor logs only after the incoming attack',
    armorAttack >= 0 && armorBlock > armorAttack && defenderAttack > armorBlock,
    armorEvents.join(' | '));

  const thorns = resolveBattle(
    player({ name: 'RuneAttacker', classPassive: null, atk: 50, hp: 100000, def: 0, crit: 0 }),
    player({
      name: 'RuneDefender', classPassive: null, atk: 50, hp: 100000, def: 0, crit: 0,
      effectRunes: [{ effect_key: 'thorns', value: 20 }],
    }),
    { mode: 'duel', rng: () => 0 },
  );
  const runeEvents = roundEvents(thorns, 1);
  const runeAttack = runeEvents.findIndex((event) => event.includes('RuneAttacker attacks'));
  const runeReflect = runeEvents.findIndex((event) => event.includes('reflects'));
  const runeDefenderAttack = runeEvents.findIndex((event) => event.includes('RuneDefender attacks'));
  check('reactive rune logs only after the incoming attack',
    runeAttack >= 0 && runeReflect > runeAttack && runeDefenderAttack > runeReflect,
    runeEvents.join(' | '));
}

// Loki Illusory Double: exact 25% turn roll, one attack evaded, then a 100% base-ATK
// counter. A multi-hit action consumes the proc on its first hit instead of countering
// every sub-hit.
{
  const attacker = () => player({
    name: 'Attacker', classPassive: null, atk: 40, hp: 100000, def: 0, crit: 0,
    specialFlags: { first_strike: true },
  });
  const loki = () => player({
    name: 'Loki User', classPassive: null, deityBlessingKey: 'loki_illusory_double',
    atk: 100, hp: 100000, def: 0, crit: 0,
  });
  const proc = resolveBattle(attacker(), loki(), {
    mode: 'duel',
    rng: scripted([0.99, 0.99, 0.249, 0.5]),
  });
  const noProc = resolveBattle(attacker(), loki(), {
    mode: 'duel',
    rng: scripted([0.99, 0.99, 0.25, 0.5]),
  });
  check('Loki proc boundary is exactly 25% each turn',
    hasEvent(roundEvents(proc, 1), 'evades the attack (Illusory Double)')
      && !hasEvent(roundEvents(noProc, 1), 'evades the attack (Illusory Double)'));
  check('Loki counter deals 100% of the user base ATK',
    hasEvent(roundEvents(proc, 1), "Loki's counter strikes Attacker for 100 DMG"),
    roundEvents(proc, 1).join(' | '));

  const multi = resolveBattle(
    player({
      name: 'Loki User', classPassive: null, deityBlessingKey: 'loki_illusory_double',
      atk: 100, hp: 1000, def: 0, crit: 0,
    }),
    mob({
      name: 'Hydra', atk: 100, hp: 1000, def: 0, crit: 0,
      specialFlags: { first_strike: true, multi_attack: 2, multi_attack_pct: 1 },
    }),
    { mode: 'raid', rng: scripted([0.99, 0, 0.99, 0.5, 0.99, 0.5]) },
  );
  const multiEvents = roundEvents(multi, 1);
  check('Loki consumes Illusory Double after one hit and one counter',
    hasEvent(multiEvents, "Loki's counter strikes Hydra for 100 DMG")
      && hasEvent(multiEvents, 'Hydra strikes (hit 1/2) — **Evaded!**')
      && !hasEvent(multiEvents, 'Hydra strikes (hit 1/2) for **0 DMG**')
      && hasEvent(multiEvents, '(hit 2/2) for **100 DMG**'),
    multiEvents.join(' | '));
}

// Poseidon Tidal Force: 30% chance each turn to Stun (1 turn) + shred enemy DEF 30% for
// 2 turns. The stun is directional CC (applied in the passive phase) → it gates the
// target's NEXT turn, not the current one. Forced proc (rng 0): stun lands turn 1, the
// mob still acts turn 1, then is gated turn 2.
{
  const sim = resolveBattle(
    player({ deityBlessingKey: 'poseidon_tidal_force', atk: 20, hp: 100000, def: 10, crit: 0 }),
    mob({ name: 'Dummy', atk: 1, hp: 100000, def: 0, crit: 0 }),
    { mode: 'raid', rng: () => 0 }
  );
  const r1 = roundEvents(sim, 1);
  const r2 = roundEvents(sim, 2);
  check('Poseidon procs stun + DEF -30% shred',
    hasEvent(r1, 'Poseidon: Tidal Force') && hasEvent(r1, 'DEF -30%'), r1.join(' | '));
  check('Poseidon stun is directional (mob acts turn 1, gated turn 2)',
    hasEvent(r1, 'Dummy strikes') && !hasEvent(r1, 'Dummy is unable to act') && hasEvent(r2, 'Dummy is unable to act'),
    `r1=${r1.join(' | ')} r2=${r2.join(' | ')}`);
}

// The same directional timing applies to all skip-CC tags, not only stun.
{
  const sim = resolveBattle(
    player({ deityBlessingKey: 'skadi_winters_hunt', atk: 20, hp: 100000, def: 10, crit: 0 }),
    mob({ name: 'Dummy', atk: 1, hp: 100000, def: 0, crit: 0 }),
    { mode: 'raid', rng: () => 0 }
  );
  const r3 = roundEvents(sim, 3);
  const r4 = roundEvents(sim, 4);
  check('non-stun skip-CC is delayed to target next turn',
    hasEvent(r3, 'Skadi: Winter') && hasEvent(r3, 'Dummy strikes') && !hasEvent(r3, 'Dummy is unable to act') && hasEvent(r4, 'Dummy is unable to act (freeze)'),
    `r3=${r3.join(' | ')} r4=${r4.join(' | ')}`);
  // [balance] Skadi frostbite: a thawing Freeze leaves the enemy Frostbitten (+50% damage).
  check('Skadi applies Frostbite when a Freeze thaws', hasEvent(allEvents(sim), 'Frostbitten'));

  const skadiUser = () => player({
    deityBlessingKey: 'skadi_winters_hunt', classPassive: null,
    atk: 100, hp: 100000, def: 0, crit: 0, specialFlags: { first_strike: true },
  });
  const proc = resolveBattle(skadiUser(), mob({ atk: 0, hp: 100000, def: 0 }),
    { mode: 'raid', rng: () => 0.299 });
  const noProc = resolveBattle(skadiUser(), mob({ atk: 0, hp: 100000, def: 0 }),
    { mode: 'raid', rng: () => 0.30 });
  check('Skadi proc boundary is exactly 30% of landed user attacks',
    hasEvent(roundEvents(proc, 1), "Skadi: Winter's Hunt") &&
      !hasEvent(roundEvents(noProc, 1), "Skadi: Winter's Hunt"));

  const frostbiteDuel = resolveBattle(
    player({
      deityBlessingKey: 'skadi_winters_hunt', weaponPassiveKey: 'laevateinn_staff',
      classPassive: null, atk: 100, hp: 100000, def: 0, crit: 0,
      specialFlags: { first_strike: true },
    }),
    player({ name: 'Target', classPassive: null, atk: 0, hp: 100000, def: 0, crit: 0 }),
    { mode: 'duel', rng: () => 0 }
  );
  check('Skadi Frostbite amplifies player-target attack damage by 50%',
    dmgOf(roundEvents(frostbiteDuel, 3), 'Hero attacks') === 135,
    roundEvents(frostbiteDuel, 3).join(' | '));
  check('Skadi Frostbite amplifies DOT damage from all combat sources by 50%',
    hasEvent(roundEvents(frostbiteDuel, 2), 'suffers 15 Burn damage'),
    roundEvents(frostbiteDuel, 2).join(' | '));
}

// [balance] Thor Mjolnir's Wrath: 30% proc → Stun + a 3-turn Paralyze DOT (20% ATK/turn).
{
  const sim = resolveBattle(
    player({ deityBlessingKey: 'thor_mjolnirs_wrath', atk: 100, hp: 100000, def: 10, crit: 0 }),
    mob({ name: 'Dummy', atk: 1, hp: 100000, def: 0, crit: 0 }),
    { mode: 'raid', rng: () => 0 }
  );
  check('Thor procs Stun + Paralyze', hasEvent(allEvents(sim), 'Stunned & Paralyzed'));
  check('Thor Paralyze deals DOT damage', hasEvent(allEvents(sim), 'Paralysis damage'));

  const thorUser = () => player({
    deityBlessingKey: 'thor_mjolnirs_wrath', weaponPassiveKey: 'mjolnir',
    classPassive: null, atk: 100, hp: 100000, def: 0, crit: 0,
    specialFlags: { first_strike: true },
  });
  const proc = resolveBattle(thorUser(), mob({ atk: 0, hp: 100000, def: 0 }),
    { mode: 'raid', rng: () => 0.299 });
  const noProc = resolveBattle(thorUser(), mob({ atk: 0, hp: 100000, def: 0 }),
    { mode: 'raid', rng: () => 0.30 });
  check('Thor proc boundary is exactly 30% of landed user attacks',
    hasEvent(roundEvents(proc, 1), "Thor: Mjolnir's Wrath") &&
      !hasEvent(roundEvents(noProc, 1), "Thor: Mjolnir's Wrath"));
  check('Thor Paralyze uses 20% user base ATK, not the buffed effective ATK',
    dmgOf(roundEvents(proc, 1), 'Hero attacks') > 100 &&
      hasEvent(roundEvents(proc, 1), 'suffers 20 Paralysis damage'),
    roundEvents(proc, 1).join(' | '));
}

// Apolaki Solar Burn is attached to landed user attacks and snapshots 10% base ATK.
{
  const sim = resolveBattle(
    player({
      deityBlessingKey: 'apolaki_solar_burn', weaponPassiveKey: 'mjolnir',
      classPassive: null, atk: 100, hp: 100000, def: 0, crit: 0,
      specialFlags: { first_strike: true },
    }),
    mob({ atk: 0, hp: 100000, def: 0 }),
    { mode: 'raid', rng: () => 0.5 }
  );
  check('Apolaki Burn is applied by the user landed attack',
    hasEvent(roundEvents(sim, 1), 'Apolaki: Solar Burn'));
  check('Apolaki Burn uses 10% user base ATK, not the buffed effective ATK',
    dmgOf(roundEvents(sim, 1), 'Hero attacks') === 130 &&
      hasEvent(roundEvents(sim, 1), 'suffers 10 Burn damage'),
    roundEvents(sim, 1).join(' | '));
}

// [balance] Surt Muspell's Flame: Burn stacks 3% to 15% ATK/turn; +50% vs burning.
{
  const sim = resolveBattle(
    player({ deityBlessingKey: 'surt_muspells_flame', atk: 100, hp: 100000, def: 10, crit: 0 }),
    mob({ name: 'Dummy', atk: 1, hp: 100000, def: 0, crit: 0 }),
    { mode: 'raid', rng: () => 0 }
  );
  const stackPcts = allEvents(sim)
    .map((event) => /Muspell's Flame — Burn (\d+)% ATK\/turn/.exec(event))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  check('Surt reaches 15% on hit five and never exceeds the cap',
    stackPcts.slice(0, 5).join(',') === '3,6,9,12,15'
      && stackPcts.slice(5).every((pct) => pct === 15)
      && Math.max(...stackPcts) === 15
      && hasEvent(allEvents(sim), '+50% vs a burning enemy'));
}

// Attack-bound passives must not apply from the passive phase while their owner is CC-skipped.
{
  const cases = [
    [{ deityBlessingKey: 'apolaki_solar_burn' }, 'Apolaki: Solar Burn'],
    [{ deityBlessingKey: 'thor_mjolnirs_wrath' }, "Thor: Mjolnir's Wrath"],
    [{ deityBlessingKey: 'skadi_winters_hunt' }, "Skadi: Winter's Hunt"],
    [{ deityBlessingKey: 'surt_muspells_flame' }, "Surt: Muspell's Flame"],
    [{ deityBlessingKey: 'poseidon_tidal_force' }, 'Poseidon: Tidal Force'],
    [{ deityBlessingKey: 'zeus_thunder_sovereign' }, 'Zeus: Chain Lightning'],
    [{ weaponPassiveKey: 'laevateinn_staff' }, 'Laevateinn Staff: Flickering Flame'],
  ];
  for (const [passive, marker] of cases) {
    const sim = resolveBattle(
      player({ ...passive, classPassive: null, atk: 10, hp: 100000, def: 0, crit: 0 }),
      player({
        name: 'Stunner', class: 'Fighter', classPassive: 'stun', atk: 10,
        hp: 100000, def: 0, crit: 0, specialFlags: { first_strike: true },
      }),
      { mode: 'duel', rng: () => 0 }
    );
    const r2 = roundEvents(sim, 2);
    check(`on-hit timing: ${marker} does not fire while owner is stunned`,
      hasEvent(r2, 'Hero is unable to act') && !hasEvent(r2, marker), r2.join(' | '));
  }
  for (const [passive, marker] of cases) {
    const sim = resolveBattle(
      player({
        ...passive, classPassive: null, atk: 10, hp: 100000, def: 0, crit: 0,
        specialFlags: { first_strike: true },
      }),
      player({
        name: 'Evader', deityBlessingKey: 'amihan_tailwind', classPassive: null,
        atk: 0, hp: 100000, def: 0, crit: 0,
      }),
      { mode: 'duel', rng: () => 0 }
    );
    const r1 = roundEvents(sim, 1);
    check(`on-hit timing: ${marker} does not fire when the user attack is evaded`,
      hasEvent(r1, 'evades the attack') && !hasEvent(r1, marker), r1.join(' | '));
  }
}

// Mob skills described as "on hit" cannot proc from the passive phase, a
// crowd-control skip, an evaded attack, or a fully negated attack.
{
  const skipped = resolveBattle(
    player({
      weaponPassiveKey: 'war_club',
      classPassive: null,
      atk: 1,
      hp: 100000,
      def: 0,
      crit: 0,
      specialFlags: { first_strike: true },
    }),
    mob({
      name: 'Lamia',
      skillKey: 'lamia_serpent_bite',
      atk: 1,
      hp: 100000,
      def: 0,
      crit: 0,
    }),
    { mode: 'raid', rng: () => 0 },
  );
  check('mob on-hit passive does not fire while its owner is CC-skipped',
    hasEvent(roundEvents(skipped, 2), 'Lamia is unable to act')
      && !hasEvent(roundEvents(skipped, 2), 'Lamia: Serpent Bite'));

  const negated = resolveBattle(
    player({
      weaponPassiveKey: 'gridr_iron_gloves',
      classPassive: null,
      atk: 1,
      hp: 100000,
      def: 0,
      crit: 0,
    }),
    mob({
      name: 'Lamia',
      skillKey: 'lamia_serpent_bite',
      atk: 100,
      hp: 100000,
      def: 0,
      crit: 0,
      specialFlags: { first_strike: true },
    }),
    { mode: 'raid', rng: () => 0 },
  );
  check('mob on-hit passive does not fire when the incoming hit is negated',
    hasEvent(roundEvents(negated, 1), 'Ironhide')
      && !hasEvent(roundEvents(negated, 1), 'Lamia: Serpent Bite'));
}

// "Next attack" bonuses stay queued through a skipped cadence turn and apply on r4.
{
  const queuedBattle = (deityBlessingKey) => resolveBattle(
    player({ deityBlessingKey, classPassive: null, atk: 100, hp: 100000, def: 0, crit: 0 }),
    player({
      name: 'Stunner', class: 'Fighter', classPassive: 'stun', atk: 1,
      hp: 100000, def: 0, crit: 0, specialFlags: { first_strike: true },
    }),
    {
      mode: 'duel',
      // Fighter fails on r1, applies its one-turn Stun on r2, and the queued
      // r3 passive survives that skipped action for the user's r4 attack.
      rng: scripted([
        0.99, 0.99, 0.99, 0.5, 0.5,
        0.99, 0.00, 0.99, 0.5, 0.5,
        0.99, 0.99, 0.99, 0.5,
        0.99, 0.00, 0.99, 0.5, 0.5,
      ], 0.99),
    }
  );
  const base = queuedBattle('none');
  const baseR4 = dmgOf(roundEvents(base, 4), 'Hero attacks');
  const idiyanale = queuedBattle('idiyanale_persistence');
  const mimir = queuedBattle('mimir_runic_knowledge');
  check('Idiyanale queued r3 bonus survives stun and lands on r4',
    hasEvent(roundEvents(idiyanale, 3), 'Idiyanale: Persistence')
      && dmgOf(roundEvents(idiyanale, 4), 'Hero attacks') > baseR4 * 1.6);
  check('Mimir queued r3 bonus survives stun and lands on r4',
    hasEvent(roundEvents(mimir, 3), 'Mimir: Runic Knowledge')
      && dmgOf(roundEvents(mimir, 4), 'Hero attacks') > baseR4 * 1.8);

  const artemis = queuedBattle('artemis_huntress_precision');
  check('Artemis r3 auto-crit survives stun and lands on r4',
    hasEvent(roundEvents(artemis, 4), 'Hero attacks')
      && hasEvent(roundEvents(artemis, 4), '(CRIT!)'));

  const vidar = resolveBattle(
    player({ deityBlessingKey: 'vidar_silent_vengeance', classPassive: null, atk: 100, hp: 100000, def: 0, crit: 0 }),
    player({
      name: 'Critter', class: 'Knight', classPassive: null, atk: 10,
      hp: 100000, def: 0, crit: 100, specialFlags: { first_strike: true },
    }),
    { mode: 'duel', rng: () => 0 }
  );
  check('Vidar returns a received crit on his same-round next attack',
    hasEvent(roundEvents(vidar, 1), 'Vidar: Silent Vengeance')
      && roundEvents(vidar, 1).some((event) => event.includes('Hero attacks') && event.includes('(CRIT!)')));
}

// Surt says each hit: Labrys' second hit on r3 must add a second Burn stack.
{
  const sim = resolveBattle(
    player({ weaponPassiveKey: 'labrys', deityBlessingKey: 'surt_muspells_flame', classPassive: null, atk: 10, hp: 100000, def: 0, crit: 0 }),
    mob({ hp: 100000, atk: 0, def: 0, crit: 0 }),
    { mode: 'raid', rng: () => 0 }
  );
  const r3 = roundEvents(sim, 3);
  check('Surt adds one Burn stack per landed Labrys hit',
    hasEvent(r3, 'Burn 9% ATK/turn') && hasEvent(r3, 'Burn 12% ATK/turn'), r3.join(' | '));
}

// Hera gains one stack for every critical hit, including multiple hits in one enemy action.
{
  const sim = resolveBattle(
    player({ deityBlessingKey: 'hera_divine_wrath', classPassive: null, atk: 10, hp: 100000, def: 0, crit: 0 }),
    mob({
      hp: 100000, atk: 10, def: 0, crit: 100,
      specialFlags: { first_strike: true, multi_attack: 3, multi_attack_pct: 0.10 },
    }),
    { mode: 'raid', rng: () => 0 }
  );
  check('Hera counts all three received crits in one action',
    hasEvent(roundEvents(sim, 2), '3 crits received') && hasEvent(roundEvents(sim, 2), 'stack 3/3'),
    roundEvents(sim, 2).join(' | '));
}

// Explicit end-of-turn stacks: turn 1 is unbuffed; five completed turns yield +50%.
{
  const run = (deityBlessingKey) => resolveBattle(
    player({ deityBlessingKey, classPassive: null, atk: 100, hp: 100000, def: 0, crit: 0 }),
    mob({ hp: 100000, atk: 0, def: 0, crit: 0 }),
    { mode: 'raid', rng: () => 0 }
  );
  const base = run('none');
  for (const [name, key] of [
    ['Mandarangan', 'mandarangan_war_frenzy'],
    ['Ares', 'ares_blood_frenzy'],
  ]) {
    const sim = run(key);
    check(`${name} end-turn stack leaves turn 1 unbuffed`,
      dmgOf(roundEvents(sim, 1), 'Hero attacks') === dmgOf(roundEvents(base, 1), 'Hero attacks'));
    check(`${name} reaches +50% after five completed turns`,
      dmgOf(roundEvents(sim, 6), 'Hero attacks') > dmgOf(roundEvents(base, 6), 'Hero attacks') * 1.45);
  }
}

// Athena's permanent 10% guard starts immediately on hit 3, even in one multi-hit action.
{
  const sim = resolveBattle(
    player({ deityBlessingKey: 'athena_aegis_shield', classPassive: null, hp: 100000, def: 0, crit: 0 }),
    mob({
      hp: 100000, atk: 100, def: 0, crit: 0,
      specialFlags: { first_strike: true, multi_attack: 3, multi_attack_pct: 1 },
    }),
    { mode: 'raid', rng: () => 0 }
  );
  const incoming = roundEvents(sim, 1)
    .filter((event) => event.includes('Dummy strikes'))
    .map((event) => Number(/\*\*(\d+) DMG\*\*/.exec(event)?.[1]));
  check('Athena reduces hits 1–2 by 40%, then hit 3 by 10%',
    incoming.length === 3 && incoming[0] === incoming[1] && incoming[2] > incoming[1],
    JSON.stringify(incoming));
}

// Magwayen drains 30% of dealt damage and Bloodlust gains one start-turn stack.
{
  const rolls = [0.99, 0.99, 0.99, 0.5, 0.5]; // mob first; both hits non-crit, pinned variance
  const magwayen = resolveBattle(
    player({ classPassive: null, deityBlessingKey: 'magwayen_soul_drain', atk: 1000, hp: 1000, def: 0, crit: 0 }),
    mob({ atk: 400, hp: 100, def: 0, crit: 0 }),
    { mode: 'raid', rng: scripted(rolls) }
  );
  check('Magwayen Soul Drain heals 30% of actual post-mitigation HP removed',
    magwayen.winner === 'a' && hasEvent(allEvents(magwayen), 'Soul Drain — healed 30 HP')
      && !hasEvent(allEvents(magwayen), 'claims the fallen soul'),
    `hp=${magwayen.a.hp}; ${allEvents(magwayen).join(' | ')}`);

  const spear = resolveBattle(
    player({ classPassive: null, weaponPassiveKey: 'spear_of_ares', atk: 1000, hp: 1000, def: 0, crit: 0 }),
    mob({ atk: 400, hp: 100, def: 0, crit: 0 }),
    { mode: 'raid', rng: scripted(rolls) }
  );
  check('Spear of Ares Bloodlust starts at one +10% stack',
    spear.winner === 'a' && hasEvent(allEvents(spear), 'Bloodlust — ATK +10% (1 stacks)'));
}

// Tyrfing executes on the subsequent attack after a target falls below its threshold.
// The target here is a PLAYER (duel mode makes both sides kind 'player'), so the bar is
// 5% of max HP, not the 10% used for mobs. Sizing: Tyrfing's own +10% ATK stack applies
// on turn one, so round-1 damage is floor(83 * 1.1) = 91, not 83. At 95 max HP the
// target survives round 1 at 4 HP (4.2%), which is under the player bar but would NOT
// have executed under the old 10%-for-everything rule.
{
  const sim = resolveBattle(
    player({ classPassive: null, weaponPassiveKey: 'tyrfing', atk: 83, hp: 1000, def: 0, crit: 0 }),
    player({ name: 'Amihan', classPassive: null, deityBlessingKey: 'amihan_tailwind', atk: 0, hp: 95, def: 0, crit: 0 }),
    { mode: 'duel', rng: scripted([
      0.0,
      0.99, 0.99, 0.99, 0.5, 0.5,
      0.99, 0.99, 0.0, 0.5,
    ]) }
  );
  const r2 = roundEvents(sim, 2);
  check('Tyrfing executes before a subsequent Tailwind evade below the player 5% bar',
    sim.winner === 'a'
      && hasEvent(r2, 'curse takes hold')
      && !hasEvent(r2, 'evades the attack (Tailwind)')
      && sim.causeOfDeath?.source === 'Cursed Edge',
    r2.join(' | '));

  const lowHpMob = resolveBattle(
    player({ classPassive: null, weaponPassiveKey: 'tyrfing', atk: 1, hp: 1000, def: 0, crit: 0 }),
    mob({
      hp: 100, poolHp: 9, poolMaxHp: 100, atk: 0, def: 0, crit: 0,
    }),
    { mode: 'raid', rng: () => 0 }
  );
  check('Tyrfing execute damage equals the target remaining HP',
    hasEvent(roundEvents(lowHpMob, 1), 'strikes for 9 damage')
      && lowHpMob.causeOfDeath?.source === 'Cursed Edge',
    roundEvents(lowHpMob, 1).join(' | '));

  const bossBelowExecuteBar = resolveBattle(
    player({ classPassive: null, weaponPassiveKey: 'tyrfing', atk: 1, hp: 1000, def: 0, crit: 0 }),
    mob({
      mobType: 'boss', hp: 100, poolHp: 9, poolMaxHp: 100, atk: 0, def: 0, crit: 0,
      immunityTags: [], specialFlags: { no_immunities: true },
    }),
    { mode: 'boss', rng: () => 0 },
  );
  check('Tyrfing execute remains blocked against no-immunity bosses',
    !hasEvent(allEvents(bossBelowExecuteBar), 'curse takes hold')
      && bossBelowExecuteBar.causeOfDeath?.source !== 'Cursed Edge',
    allEvents(bossBelowExecuteBar).join(' | '));
}

// — Fighter stun: exactly 25%, exactly one skipped turn, Bash is 100%, Dizzy remains visible. —
{
  const mkF = () => player({ class: 'Fighter', classPassive: 'stun' });
  check('Fighter constants are 25% Stun for 1 turn and 100% Bash',
    FIGHTER_STUN_CHANCE === 0.25
      && FIGHTER_STUN_TURNS === 1
      && FIGHTER_BASH_DAMAGE_PCT === 1.00);

  const noOpeningStun = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.25]) });
  check('Fighter 25% boundary does not Stun',
    !hasEvent(roundEvents(noOpeningStun, 1), 'blow stuns')
      && hasEvent(roundEvents(noOpeningStun, 1), 'strikes'));

  const stunned = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.24]) });
  const r1 = roundEvents(stunned, 1);
  const r2 = roundEvents(stunned, 2);
  const r3 = roundEvents(stunned, 3);
  const mainDamage = dmgOf(r1, 'Hero attacks');
  const bashDamage = dmgOf(r1, 'follows with Bash');
  check('Fighter Stun logs exactly 1 turn', hasEvent(r1, 'stuns Dummy for 1 turn!')
    && !hasEvent(allEvents(stunned), 'stuns Dummy for 2 turns!'));
  check('Fighter Bash is exactly 100% of the triggering hit',
    bashDamage === Math.floor(mainDamage * FIGHTER_BASH_DAMAGE_PCT),
    `main=${mainDamage}, bash=${bashDamage}`);
  check('Fighter Dizzy remains visible in application and skipped-turn logs',
    hasEvent(r1, 'becomes Dizzy and is stunned for 1 turn')
      && hasEvent(r2, 'Dizzy, stun'));
  check('new Stun does not cancel the target action already due in round 1',
    hasEvent(r1, 'Dummy strikes'));
  check('Fighter target skips exactly round 2 and acts normally in round 3',
    hasEvent(r2, 'unable to act')
      && !hasEvent(r2, 'Dummy strikes')
      && hasEvent(r3, 'Dummy strikes'));

  const lethalBash = resolveBattle(
    player({
      class: 'Fighter',
      classPassive: 'stun',
      atk: 100,
      hp: 1000,
      def: 0,
      crit: 0,
    }),
    mob({ hp: 150, atk: 0, def: 0, crit: 0 }),
    { mode: 'boss', rng: () => 0 },
  );
  check('lethal Fighter Bash does not apply or log Dizzy after death',
    lethalBash.winner === 'a'
      && !hasEvent(allEvents(lethalBash), 'becomes Dizzy'),
    allEvents(lethalBash).join(' | '));
  check('Dizzy does not add a second missed action',
    !hasEvent(allEvents(stunned), 'misses its attack due to Dizzy'));

  const guarded = resolveBattle(mkF(), mob({ hp: 100000 }), { seed: 1, rng: () => 0 });
  let forcedWorst = 0;
  let forcedStreak = 0;
  let forcedFreeActions = 0;
  for (const battleRound of guarded.rounds) {
    if (hasEvent(battleRound.events, 'Dummy is unable to act')) {
      forcedStreak += 1;
      forcedWorst = Math.max(forcedWorst, forcedStreak);
    } else {
      forcedStreak = 0;
      if (hasEvent(battleRound.events, 'Dummy strikes')) forcedFreeActions += 1;
    }
  }
  check('Fighter repeated procs never exceed one consecutive skipped turn',
    forcedWorst === 1 && forcedFreeActions >= 1,
    `worst=${forcedWorst}, freeActions=${forcedFreeActions}`);

  const mixedStuns = resolveBattle(
    player({ class: 'Fighter', classPassive: 'stun', deityBlessingKey: 'poseidon_tidal_force', atk: 5 }),
    mob({ hp: 100000 }),
    { seed: 1, rng: () => 0 }
  );
  const firstThree = [1, 2, 3].flatMap((round) => roundEvents(mixedStuns, round));
  check('central guard still prevents Poseidon from refreshing Fighter Stun',
    firstThree.filter((event) => event.includes('blow stuns')).length === 1
      && hasEvent(roundEvents(mixedStuns, 3), 'Dummy strikes'),
    firstThree.join(' | '));

  const immune = resolveBattle(mkF(), mob({ hp: 100000, immunityTags: ['stun'] }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.0]) });
  check('Fighter Stun immunity behavior is unchanged',
    !hasEvent(allEvents(immune), 'blow stuns') && hasEvent(roundEvents(immune, 1), 'strikes'));
}

{
  const shieldmaiden = resolveBattle(
    player({
      name: 'Guard',
      class: 'Swordsman',
      classPassive: 'none',
      atk: 0,
      hp: 1000,
      def: 0,
      crit: 0,
      armorPassiveKey: 'skjaldmaer',
      armorName: 'Skjaldmaer',
    }),
    mob({
      hp: 1000,
      atk: 100,
      def: 0,
      crit: 0,
      specialFlags: { first_strike: true },
    }),
    { mode: 'raid', rng: () => 0 },
  );
  check("Skjaldmaer's proc reflects 60% of the 90 would-be damage",
    hasEvent(roundEvents(shieldmaiden, 1), "Shieldmaiden's Guard reflects 54 damage"),
    roundEvents(shieldmaiden, 1).join(' | '));
}

// Round 1 is a clean Bernoulli draw, so the observed proc rate must be 25%
// and no legacy two-turn path may appear.
{
  const N = 4000;
  let oneTurn = 0;
  let twoTurn = 0;
  for (let seed = 1; seed <= N; seed += 1) {
    const sim = resolveBattle(
      player({ class: 'Fighter', classPassive: 'stun', atk: 10 }),
      mob({ hp: 1_000_000, def: 0 }),
      { seed }
    );
    const r1 = roundEvents(sim, 1);
    if (hasEvent(r1, 'for 1 turn!')) oneTurn += 1;
    if (hasEvent(r1, 'for 2 turns!')) twoTurn += 1;
  }
  const procRate = oneTurn / N;
  console.log(`   Fighter proc-rate over ${N} battles (round 1): ${(procRate * 100).toFixed(1)}% (exp 25%)`);
  check('Fighter Stun proc rate ≈ 25%',
    Math.abs(procRate - FIGHTER_STUN_CHANCE) < 0.03,
    `got ${(procRate * 100).toFixed(1)}%`);
  check('Fighter has no two-turn Stun path', twoTurn === 0, `found ${twoTurn}`);
}

// — R8: def_down sources combine highest-wins —
{
  // Laevateinn and Zeus remain highest-wins rather than combining multiplicatively.
  const mk = () => player({ weaponPassiveKey: 'laevateinn_sword', deityBlessingKey: 'zeus_thunder_sovereign' });
  const sim = resolveBattle(mk(), mob({ hp: 50000, def: 200 }), { seed: 1, rng: () => 0 });
  const r3 = dmgOf(roundEvents(sim, 3), 'attacks');
  check('R8: Zeus procs Chain Lightning', hasEvent(roundEvents(sim, 3), 'Chain Lightning'));
  check('R8: highest-wins r3 damage = 571', r3 === 571, `got ${r3}`);
}

// — def_down immunity blocks ALL sources including the laevateinn stack —
{
  const mk = () => player({ weaponPassiveKey: 'laevateinn_sword', deityBlessingKey: 'zeus_thunder_sovereign' });
  const sim = resolveBattle(mk(), mob({ hp: 50000, def: 200, immunityTags: ['def_down'] }),
    { seed: 1, rng: () => 0 });
  check('def_down-immune: no Sundering Flame stacks', !hasEvent(allEvents(sim), 'Sundering Flame'));
  const r3 = dmgOf(roundEvents(sim, 3), 'attacks');
  check('def_down-immune r3 damage = 486', r3 === 486, `got ${r3}`);
}

// — R9: Babaylan ATK +100% only on a non-empty cleanse —
{
  const mkB = () => player({ weaponPassiveKey: 'babaylans_ritual_staff' });
  // no debuff source at all → never fires
  const clean = resolveBattle(mkB(), mob({ hp: 100000 }), { mode: 'raid', seed: 3 });
  check('R9: empty cleanse grants no ATK buff', !hasEvent(allEvents(clean), 'ATK +100%'));
  // lamia bleed lands r1 (mob skill runs after the cleanse) → cleansed r2 → buff fires r2
  const sim = resolveBattle(
    mkB(),
    mob({ hp: 100000, skillKey: 'lamia_serpent_bite' }),
    { seed: 1, rng: () => 0 },
  );
  check('R9: bleed applied r1', hasEvent(roundEvents(sim, 1), 'Serpent Bite'));
  check('R9: cleanse + buff fires r2', hasEvent(roundEvents(sim, 2), 'ATK +100%'));
}

// — instakill: kills regular mob; blocked vs boss; disabled in duels —
{
  const mkK = () => player({ weaponPassiveKey: 'knuckle_charm_anting_anting' });
  const sKill = resolveBattle(mkK(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.01, 0.5]) });
  check('instakill kills regular mob round 1', sKill.winner === 'a' && sKill.outcome === 'instakill' && sKill.rounds.length === 1,
    `winner=${sKill.winner} outcome=${sKill.outcome}`);
  const sBoss = resolveBattle(mkK(), mob({ hp: 100000, mobType: 'boss' }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.01, 0.5]) });
  check('instakill blocked vs boss', sBoss.outcome !== 'instakill' && sBoss.rounds.length > 1);
  check('instakill logs boss block reason', hasEvent(allEvents(sBoss), 'has no effect on bosses'));
  const sDuel = resolveBattle(mkK(), player({ name: 'Rival', hp: 100000 }),
    { mode: 'duel', seed: 1, rng: scripted([0.0, 0.99, 0.99, 0.01, 0.5, 0.5]) });
  check('instakill works in duels', sDuel.outcome === 'instakill'
    && sDuel.causeOfDeath?.source === 'Death Charm');
}

// — rupture / hemorrhage: land on mobs, hard-blocked vs all bosses —
{
  const mkR = () => player({ weaponPassiveKey: 'badiang_stalk' });
  const sMob = resolveBattle(mkR(), mob({ hp: 10000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.01, 0.5]) });
  check('rupture bursts mob for 10% maxHP (1000)', hasEvent(roundEvents(sMob, 1), 'Rupture deals 1000'));
  const sBoss = resolveBattle(
    mkR(),
    mob({ hp: 10000, mobType: 'boss', immunityTags: [], specialFlags: { no_immunities: true } }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.01, 0.5]) });
  check('rupture and Venom auto-blocked vs every boss, including no-immunity bosses',
    hasEvent(allEvents(sBoss), 'Rupture has no effect on bosses')
      && !hasEvent(allEvents(sBoss), 'Venom applied for 2 turns')
      && !hasEvent(allEvents(sBoss), 'Venom ticks'));
  const sLegacyBoss = resolveBattle(
    mkR(),
    mob({ hp: 10000, mobType: 'boss' }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.01, 0.5]) });
  check('legacy bosses inherit the same Rupture and Venom immunity',
    hasEvent(allEvents(sLegacyBoss), 'Rupture has no effect on bosses')
      && !hasEvent(allEvents(sLegacyBoss), 'Venom applied for 2 turns')
      && !hasEvent(allEvents(sLegacyBoss), 'Venom ticks'));
  const mkH = () => player({ weaponPassiveKey: 'gusisnautar' });
  const hMob = resolveBattle(mkH(), mob({ hp: 10000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.01, 0.5]) });
  check('hemorrhage tears mob', hasEvent(roundEvents(hMob, 1), 'Hemorrhage deals 500'));
  const hBoss = resolveBattle(
    mkH(),
    mob({ hp: 10000, mobType: 'boss', immunityTags: [], specialFlags: { no_immunities: true } }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.01, 0.5]) });
  check('hemorrhage auto-blocked vs every boss, including no-immunity bosses',
    hasEvent(allEvents(hBoss), 'Hemorrhaging Shot has no effect on bosses')
      && !hasEvent(allEvents(hBoss), 'Hemorrhage deals'));
}

// — Fenrir: bleed immunity covers class bleed AND weapon bleed —
{
  const mkS = () => player({ class: 'Swordsman', classPassive: 'bleed', weaponPassiveKey: 'cutlass' });
  const sImm = resolveBattle(mkS(), mob({ hp: 30000, immunityTags: ['bleed', 'stun'] }), { seed: 7 });
  check('Fenrir: no Bleed events at all', !hasEvent(allEvents(sImm), 'Bleed'));
  const sPlain = resolveBattle(mkS(), mob({ hp: 30000 }), { seed: 7 });
  check('control: Swordsman bleeds a plain mob', hasEvent(allEvents(sPlain), 'Bleed'));
}

// — Sleipnir first_strike: boss acts first, no order roll —
{
  const sim = resolveBattle(player(), mob({ hp: 100000, mobType: 'boss', specialFlags: { first_strike: true } }),
    { seed: 1, rng: scripted([0.99, 0.99, 0.5, 0.5]) }); // critPre(A), mobCrit, mobVar, playerVar
  const ev = roundEvents(sim, 1);
  const iMob = ev.findIndex((e) => e.includes('strikes'));
  const iPlayer = ev.findIndex((e) => e.includes('attacks'));
  check('Sleipnir acts first', iMob !== -1 && iPlayer !== -1 && iMob < iPlayer,
    `mob@${iMob} player@${iPlayer}`);
}

// — Cerberus multi_attack: 2 sub-hits × 60%, rider once (R4) —
{
  const sim = resolveBattle(player({ hp: 50000 }),
    mob({ hp: 100000, mobType: 'boss', atk: 200, specialFlags: { multi_attack: 2, multi_attack_pct: 0.60 } }),
    { seed: 11 });
  const ev = roundEvents(sim, 1);
  check('Cerberus hit 1/2 present', hasEvent(ev, '(hit 1/2)'));
  check('Cerberus hit 2/2 present', hasEvent(ev, '(hit 2/2)'));
}

// — Hydra: local regen only; net damage = dealt − regen —
{
  const sim = resolveBattle(player({ atk: 1500 }), mob({ hp: 100000, mobType: 'boss', skillKey: 'hydra_regen', immunityTags: ['def_down'] }),
    { seed: 13 });
  const t = sim.totals;
  check('Hydra regen occurred', t.enemyLocalRegen > 0, `regen=${t.enemyLocalRegen}`);
  check('netDamage = max(0, dealt − regen)', t.netDamage === Math.max(0, t.damageDealtToEnemy - t.enemyLocalRegen),
    `dealt=${t.damageDealtToEnemy} regen=${t.enemyLocalRegen} net=${t.netDamage}`);
  check('Hydra regen event logged', hasEvent(allEvents(sim), 'Hydra: Regeneration'));
}

// — Sidapa: survive lethal at 1 HP exactly once —
{
  const sim = resolveBattle(
    player({
      hp: 100, atk: 100, def: 0, crit: 0, classPassive: null,
      deityBlessingKey: 'sidapa_deaths_reprieve', specialFlags: { first_strike: true },
    }),
    mob({ hp: 100000, atk: 10000, def: 0 }),
    { mode: 'raid', rng: () => 0.5 }
  );
  check('Sidapa reprieve fires on the user first lethal hit and heals 30% user max HP',
    hasEvent(roundEvents(sim, 1), "Death's Reprieve") && hasEvent(roundEvents(sim, 1), 'heals 30 HP'));
  check('Sidapa grants the user +50% ATK for the rest of battle',
    dmgOf(roundEvents(sim, 2), 'Hero attacks') === 150,
    roundEvents(sim, 2).join(' | '));
  check('Sidapa: second lethal kills (once per battle)', sim.winner === 'b' && sim.rounds.length === 2,
    `winner=${sim.winner} rounds=${sim.rounds.length}`);
}

// Baldur triggers strictly below 50% user HP, heals from user max HP, and guards one turn.
{
  const baldurUser = () => player({
    hp: 100, atk: 0, def: 0, crit: 0, classPassive: null,
    deityBlessingKey: 'baldur_invulnerability', specialFlags: { first_strike: true },
  });
  const atHalf = resolveBattle(baldurUser(), mob({ hp: 100000, atk: 50, def: 0 }),
    { mode: 'raid', rng: () => 0.5 });
  const belowHalf = resolveBattle(baldurUser(), mob({ hp: 100000, atk: 51, def: 0 }),
    { mode: 'raid', rng: () => 0.5 });
  check('Baldur does not trigger at exactly 50% user HP',
    !hasEvent(allEvents(atHalf), 'Baldur: Invulnerability'));
  check('Baldur triggers below 50%, heals 15% user max HP, and halves one incoming hit',
    hasEvent(roundEvents(belowHalf, 2), 'Healed 15 HP') &&
      dmgOf(roundEvents(belowHalf, 2), 'Dummy strikes') === 25,
    roundEvents(belowHalf, 2).join(' | '));
  check('Baldur triggers only once per battle',
    allEvents(belowHalf).filter((event) => event.includes('Baldur: Invulnerability')).length === 1);
}

// — Mantle of Bathala: +6% max HP and +4% reduction per turn, capped on turn 5 —
{
  const sim = resolveBattle(
    player({ atk: 0, hp: 1000, def: 100, armorPassiveKey: 'mantle_of_bathala' }),
    mob({ atk: 0, hp: 1000, def: 100 }),
    { seed: 23 }
  );
  const mantleEvents = allEvents(sim).filter((e) => e.includes('Divine Aegis'));
  const maxLoggedPct = Math.max(...mantleEvents.map((e) => Number(/\+(\d+)%/.exec(e)?.[1] || 0)));
  check('Mantle of Bathala caps max HP at +30%', sim.a.maxHp === 1300, `maxHp=${sim.a.maxHp}`);
  check('Mantle of Bathala never logs above +30% max HP', maxLoggedPct === 30, `max=${maxLoggedPct}%`);
  check('Mantle of Bathala remains capped after turn 10',
    hasEvent(roundEvents(sim, 11), '+30% max HP · 20% reduction (5/5)'));
}

// — Sudden death from round 30; mutual drain death → mob/challenged wins (R5) —
{
  const sim = resolveBattle(player({ atk: 0, hp: 1000 }), mob({ hp: 1000, atk: 0 }), { seed: 17 });
  check('sudden death: both die round 39', sim.rounds.length === 39, `rounds=${sim.rounds.length}`);
  check('sudden death mutual → b wins', sim.winner === 'b' && sim.outcome === 'sudden_death',
    `winner=${sim.winner} outcome=${sim.outcome}`);
  check('drain events from round 30', hasEvent(roundEvents(sim, 30), 'Sudden death'));
  check('no drain before round 30', !hasEvent(roundEvents(sim, 29), 'Sudden death'));
}

// — round-50 cap: higher HP% wins; tie → mob/challenged; boss → timeout —
{
  // maxHp ≤ 9 → drain floors to 0 → both survive to the cap
  const sCap = resolveBattle(player({ atk: 0, hp: 9 }), mob({ hp: 9, atk: 0, poolHp: 5, poolMaxHp: 9 }), { seed: 19 });
  check('cap: 50 rounds reached', sCap.rounds.length === 50, `rounds=${sCap.rounds.length}`);
  check('cap: higher HP% wins → a', sCap.winner === 'a' && sCap.outcome === 'cap_hp_pct',
    `winner=${sCap.winner} outcome=${sCap.outcome}`);
  const sTie = resolveBattle(player({ atk: 0, hp: 9 }), mob({ hp: 9, atk: 0 }), { seed: 19 });
  check('cap tie → mob/challenged (b)', sTie.winner === 'b' && sTie.outcome === 'cap_hp_pct',
    `winner=${sTie.winner}`);
  const sBoss = resolveBattle(player({ atk: 0, hp: 9 }), mob({ hp: 9, atk: 0, mobType: 'boss' }),
    { mode: 'boss', seed: 19 });
  check('boss cap → timeout, survived', sBoss.outcome === 'boss_timeout', `outcome=${sBoss.outcome}`);
}

// — R3: a fully absorbed hit consumes nothing (Gridr ignore ≠ Heimdall consume) —
{
  const mk = () => player({ class: 'Mage', classPassive: 'overcharge', weaponPassiveKey: 'gridr_iron_gloves', deityBlessingKey: 'heimdall_eternal_vigilance' });
  // order .9 → mob first. Each incoming hit rolls Ironhide after mob crit/variance.
  const sim = resolveBattle(mk(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([
      0.9, 0.99, 0.99, 0.5, 0.01, 0.5,
      0.99, 0.99, 0.5, 0.99, 0.5,
    ]) });
  check('R3: Gridr keeps a zero-damage line for absorbed damage',
    hasEvent(roundEvents(sim, 1), 'Ironhide')
      && hasEvent(roundEvents(sim, 1), 'for **0 DMG**')
      && !hasEvent(roundEvents(sim, 1), '**Evaded!**'),
    roundEvents(sim, 1).join(' | '));
  check('R3: heimdall NOT consumed by the absorbed hit', hasEvent(roundEvents(sim, 2), 'Heimdall negates'));
  check('R3: heimdall halves r2 hit to 28', dmgOf(roundEvents(sim, 2), 'strikes') === 28,
    `got ${dmgOf(roundEvents(sim, 2), 'strikes')}`);
}

// — combat EXP curve (§17): within-level semantics, multi-level, cap 50 —
{
  check('expRequired covers exactly levels 1..99', Object.keys(EXP_REQUIRED).length === 99 && MAX_COMBAT_LEVEL === 100);
  const a = applyCombatExp(1, 0, 100);
  check('exp: 1→2 at exactly 100', a.level === 2 && a.exp === 0 && a.leveledUp, JSON.stringify(a));
  const b = applyCombatExp(1, 0, 850);
  check('exp: multi-level 1→4 (100+250+500)', b.level === 4 && b.exp === 0, JSON.stringify(b));
  const c = applyCombatExp(1, 50, 100);
  check('exp: within-level carry (50+100 → L2, 50 over)', c.level === 2 && c.exp === 50, JSON.stringify(c));
  const d = applyCombatExp(10, 0, 11999);
  check('exp: no level below threshold (10→11 needs 12000)', d.level === 10 && d.exp === 11999 && !d.leveledUp, JSON.stringify(d));
  const e = applyCombatExp(99, 0, 90000000);
  check('exp: 99→100 cap reached', e.level === 100 && e.exp === 0, JSON.stringify(e));
  const f = applyCombatExp(100, 0, 999999);
  check('exp: level 100 never levels further', f.level === 100 && !f.leveledUp, JSON.stringify(f));
}

// — duel: both sides run weapon+deity; Alan's blocks the opponent's class stun —
{
  const a = player({ class: 'Fighter', classPassive: 'stun', hp: 50000 });
  const b = player({ name: 'Rival', hp: 50000, weaponPassiveKey: 'alans_reversed_hands' });
  // order 0 → A first. pre-rolls: A critPre .99, A stun 0.05 (2-turn proc); B critPre .99.
  // A attacks (var .5) → stun BLOCKED by Alan's; B attacks (var .5) normally.
  const sim = resolveBattle(a, b, { mode: 'duel', seed: 1, rng: scripted([0.0, 0.99, 0.05, 0.99, 0.5, 0.5, 0.99, 0.99, 0.99, 0.5, 0.5]) });
  check('duel: stun blocked by status immunity', !hasEvent(allEvents(sim), 'stuns'));
  check('duel: defender never skips', !hasEvent(roundEvents(sim, 2), 'unable to act'));
  const r1 = roundEvents(sim, 1);
  check('duel: both duelists attack r1', r1.filter((e) => e.includes('attacks')).length === 2);
  // pvp_logs inputs: both damage directions tracked, order roll exposed
  check('duel: challenger damage tracked', sim.totals.damageDealtToEnemy > 0, JSON.stringify(sim.totals));
  check('duel: opponent damage tracked', sim.totals.damageDealtToPlayer > 0, JSON.stringify(sim.totals));
  check('playerFirst exposed as boolean', typeof sim.playerFirst === 'boolean');
}

// Alan's status immunity does not prevent DOT applications or damage.
{
  const attacker = player({
    name: 'ApolakiUser', atk: 100, hp: 10000, def: 0, crit: 0,
    deityBlessingKey: 'apolaki_solar_burn',
  });
  const alan = player({
    name: 'Alan', atk: 1, hp: 10000, def: 0, crit: 0,
    weaponPassiveKey: 'alans_reversed_hands',
  });
  const sim = resolveBattle(attacker, alan, { mode: 'duel', rng: () => 0.5 });
  check('Alan does not block Burn DOT',
    hasEvent(allEvents(sim), 'Apolaki: Solar Burn')
      && hasEvent(allEvents(sim), 'Alan suffers 10 Burn damage'));
}

// ════════════════════════════════════════════════════════════════════════════
section('4b. Armor rework safety contracts');

{
  const sim = resolveBattle(
    player({
      name: 'Attacker', classPassive: null, atk: 100, hp: 10, def: 0, crit: 0,
      specialFlags: { first_strike: true },
    }),
    player({
      name: 'Defender', classPassive: null, atk: 0, hp: 1000, def: 0, crit: 0,
      armorPassiveKey: 'enderby_shield',
    }),
    { mode: 'duel', rng: () => 0.5 },
  );
  const events = roundEvents(sim, 1);
  const attackAt = events.findIndex((event) => event.includes('Attacker attacks'));
  const reflectAt = events.findIndex((event) => event.includes('Thornward reflects'));
  const defeatAt = events.findIndex((event) => event.includes("defeated by Thornward's reflected damage"));
  check('reflect kill is attributed and ordered after the triggering attack',
    sim.winner === 'b'
      && sim.causeOfDeath?.type === 'reflect'
      && sim.causeOfDeath?.source === 'Thornward'
      && attackAt >= 0
      && reflectAt > attackAt
      && defeatAt > reflectAt,
    events.join(' | '));
}

{
  const sim = resolveBattle(
    player({
      name: 'Attacker', classPassive: null, atk: 100, hp: 100000, def: 0, crit: 0,
    }),
    player({
      name: 'Defender', classPassive: null, atk: 1, hp: 100000, def: 0, crit: 0,
      weaponPassiveKey: 'enderby_shield',
      deityBlessingKey: 'skadi_winters_hunt',
      specialFlags: { first_strike: true },
    }),
    { mode: 'duel', rng: () => 0 },
  );
  const events = roundEvents(sim, 3);
  const attackDamage = dmgOf(events, 'Attacker attacks');
  const reflected = Number(
    /Thornward reflects (\d+) damage/.exec(
      events.find((event) => event.includes('Thornward reflects')) || '',
    )?.[1],
  );
  check('reflect stays the exact post-mitigation percentage against a Frostbitten attacker',
    reflected === Math.floor(attackDamage * 0.12),
    `attack=${attackDamage} reflect=${reflected}; ${events.join(' | ')}`);
}

{
  const sim = resolveBattle(
    player({
      classPassive: 'damage_reduction', atk: 0, hp: 10000, def: 0, crit: 0,
      armorPassiveKey: 'mail_of_brokkr',
      effectRunes: [{ effect_key: 'aegis_rune', value: 50 }],
    }),
    mob({
      atk: 1000, hp: 100000, def: 0, crit: 0,
      specialFlags: { first_strike: true },
    }),
    { mode: 'raid', rng: () => 0.5 },
  );
  check('summed damage reduction is capped at 70%',
    dmgOf(roundEvents(sim, 1), 'Dummy strikes') === 300,
    roundEvents(sim, 1).join(' | '));
}

section('5. Fuzz — ~2,000 seeded battles, invariants');
{
  const md = fs.readFileSync(path.join(ROOT, 'assets', 'data', 'passive_registry_keys.md'), 'utf8');
  const grab = (header, stop) => {
    const seg = md.slice(md.indexOf(header), stop ? md.indexOf(stop) : undefined);
    return [...seg.matchAll(/^- `([a-z0-9_]+)`/gm)].map((m) => m[1]);
  };
  const weaponKeys = grab('## WEAPON', '## DEITY');
  const deityKeys = grab('## DEITY', '## MOB');
  const mobKeys = grab('## MOB');
  const classes = [
    ['Swordsman', 'bleed'], ['Fighter', 'stun'], ['Mage', 'overcharge'],
    ['Knight', 'damage_reduction'], ['Archer', 'pierce'],
  ];
  const tagPool = ['stun', 'bleed', 'burn', 'def_down', 'armor_pierce', 'all_debuffs'];

  const fx = rngOf(424242); // fixture stream, separate from battle seeds
  const pick = (arr) => arr[Math.floor(fx() * arr.length)];
  let ok = true, detail = '';
  const N = 2000;
  for (let i = 1; i <= N; i++) {
    const [cls, cp] = pick(classes);
    const mode = fx() < 0.15 ? 'duel' : (fx() < 0.5 ? 'boss' : 'raid');
    const a = player({
      class: cls, classPassive: cp,
      atk: 50 + Math.floor(fx() * 800), hp: 200 + Math.floor(fx() * 6000),
      def: Math.floor(fx() * 400), crit: Math.floor(fx() * 46),
      bonusDmgPct: fx() < 0.2 ? 50 : 0,
      weaponPassiveKey: pick(weaponKeys), deityBlessingKey: pick(deityKeys),
    });
    const b = mode === 'duel'
      ? player({
          name: 'Rival', class: pick(classes)[0], classPassive: pick(classes)[1],
          atk: 50 + Math.floor(fx() * 800), hp: 200 + Math.floor(fx() * 6000),
          def: Math.floor(fx() * 400), crit: Math.floor(fx() * 46),
          weaponPassiveKey: pick(weaponKeys), deityBlessingKey: pick(deityKeys),
        })
      : mob({
          mobType: mode === 'boss' ? 'boss' : (fx() < 0.5 ? 'regular' : 'elite'),
          atk: 30 + Math.floor(fx() * 600), hp: 200 + Math.floor(fx() * 20000),
          def: Math.floor(fx() * 400), crit: Math.floor(fx() * 31),
          skillKey: pick(mobKeys),
          immunityTags: fx() < 0.3 ? [pick(tagPool)] : [],
          specialFlags: fx() < 0.1 ? { multi_attack: 2, multi_attack_pct: 0.6 } : (fx() < 0.1 ? { first_strike: true } : {}),
        });

    let sim;
    try {
      sim = resolveBattle(a, b, { mode, seed: i });
    } catch (err) {
      ok = false; detail = `battle ${i} threw: ${err.message}`; break;
    }
    const bad = (msg) => { ok = false; detail = `battle ${i} (${a.weaponPassiveKey}/${a.deityBlessingKey}/${b.skillKey || b.weaponPassiveKey}, ${mode}): ${msg}`; };
    if (!['a', 'b'].includes(sim.winner)) { bad(`winner=${sim.winner}`); break; }
    if (sim.rounds.length < 1 || sim.rounds.length > 50) { bad(`rounds=${sim.rounds.length}`); break; }
    let snapBad = false;
    for (const s of sim.snapshots) {
      for (const side of [s.a, s.b]) {
        if (!(side.hp >= 0 && side.hp <= side.maxHp) || Number.isNaN(side.hp)) { snapBad = true; }
      }
    }
    if (snapBad) { bad('snapshot HP out of bounds'); break; }
    const t = sim.totals;
    if ([t.damageDealtToEnemy, t.damageDealtToPlayer, t.enemyLocalRegen, t.netDamage]
      .some((v) => !(v >= 0) || Number.isNaN(v))) {
      bad(`totals ${JSON.stringify(t)}`); break;
    }
    if (t.netDamage !== Math.max(0, t.damageDealtToEnemy - t.enemyLocalRegen)) { bad('net-damage identity'); break; }
    if (sim.rounds.some((r) => r.events.some((e) => typeof e !== 'string'))) { bad('non-string event'); break; }
  }
  check(`${N}-battle fuzz invariants`, ok, detail);
}

// — Boss daily attack cap —
{
  section('§1.4 boss attack cap');
  const { MAX_BOSS_ATTACKS_PER_DAY, bossAttackDecision } =
    require(path.join(ROOT, 'src', 'config', 'bosses'));
  const limit = MAX_BOSS_ATTACKS_PER_DAY;
  check('cap constant is 2', limit === 2, `limit=${limit}`);

  // Two attacks in a day succeed, the third is blocked.
  const d1 = bossAttackDecision({ usedToday: 0, limit });
  const d2 = bossAttackDecision({ usedToday: 1, limit });
  const d3 = bossAttackDecision({ usedToday: 2, limit });
  check('1st attack allowed', d1.allowed === true);
  check('2nd attack allowed', d2.allowed === true);
  check('3rd attack blocked by daily cap', d3.allowed === false && d3.reason === 'daily');

  const dNextDaySameSpawn = bossAttackDecision({ usedToday: 0, limit });
  check('next day resets on the same spawn', dNextDaySameSpawn.allowed === true);

  const bossSource = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'bossSystem.js'), 'utf8');
  const bossConfigSource = fs.readFileSync(path.join(ROOT, 'src', 'config', 'bosses.js'), 'utf8');
  const bossSchedulerSource = fs.readFileSync(path.join(ROOT, 'src', 'schedulers', 'bossScheduler.js'), 'utf8');
  check('same-spawn upsert resets the daily counter', /attacks = CASE[\s\S]*?ELSE 1[\s\S]*?last_daily_reset =/.test(bossSource));
  check('no lifetime per-spawn attack gate remains', !/SELECT attacks FROM boss_attack_log WHERE boss_spawn_id/.test(bossSource));
  check('boss spawn uses fixed roster stats and no level scaling',
    /const stats = computeBossStats\(row\);/.test(bossSource)
      && /const maxHp = bossMaxHpForChest\(/.test(bossSource)
      && !/bossLevel|hpScaleOrder/.test(bossSource));
  check('boss spawn path has no global or ATK/DEF stat multiplier',
    !/scaledBossStats|bossStatMultiplier|bossAttackDefenseMultiplier|BOSS_STAT_MULTIPLIER|BOSS_ATK_DEF_MULTIPLIER/.test(bossSource)
      && !/stats\.(?:atk|def|crit)\s*\*/.test(bossSource));
  check('Greater HP multiplier follows the rolled chest only',
    hpMultiplierForChest(rollBossChest('Jotun', () => 0.99)) === 1.5
      && hpMultiplierForChest(rollBossChest('Jotun', () => 0)) === 2
      && hpMultiplierForChest({ column: 'boss_treasure_chest', qty: 1 }) === 1
      && bossMaxHpForChest(100, 10, 5, rollBossChest('Jotun', () => 0.99)) === 150
      && bossMaxHpForChest(100, 10, 5, rollBossChest('Jotun', () => 0)) === 200
      && inferChestFromGreaterHp(100, 150)?.column === 'boss_treasure_chest'
      && inferChestFromGreaterHp(100, 200)?.column === 'boss_golden_chest'
      && inferChestFromGreaterHp(100, 100) === null
      && /const hpMultiplier = greater \? hpMultiplierForChest\(spawnChest\) : 1;/.test(bossSource)
      && /GREATER_TREASURE_HP_MULTIPLIER\s*=\s*1\.5/.test(bossConfigSource)
      && /GREATER_GOLDEN_HP_MULTIPLIER\s*=\s*2/.test(bossConfigSource));
  check('Greater chest outcome is recoverable from persisted max HP after restart',
    /inferChestFromGreaterHp\(baseHp, maxHp\)/.test(bossSource)
      && /RETURNING mob_id, max_hp, spawn_source/.test(bossSource));
  check('Greater identity and chest rewards remain configured',
    GREATER_BOSSES.size === 3
      && CALAMITY_BOSSES.size === 2
      && rollBossChest('Jotun', () => 0).column === 'boss_golden_chest'
      && rollBossChest('Jotun', () => 0.99).qty === 2
      && rollBossChest('Medusa', () => 0).qty === 1
      && CALAMITY_SPAWN_CHANCE === 0.05
      && GREATER_SPAWN_CHANCE === 0.25
      && NORMAL_SPAWN_CHANCE === 0.70
      && GREATER_CHEST_GOLDEN_CHANCE === 0.25
      && bossRewards('Jotun', rollBossChest('Jotun', () => 0.99)) === GREATER_TWIN_REWARD
      && bossRewards('Jotun', rollBossChest('Jotun', () => 0)) === GREATER_GOLDEN_REWARD
      && !bossConfigSource.includes('Golden Treasure Chest'));
  check('Calamity rewards and spawn chest variants are fixed',
    bossChestForSpawn('Fenrir', 'natural').qty === 1
      && bossChestForSpawn('Fenrir', 'natural').column === 'boss_golden_chest'
      && bossChestForSpawn('Fenrir', 'dev').column === 'boss_golden_chest'
      && bossChestForSpawn('Fenrir', 'dev').qty === 1
      && bossRewards('Fenrir').credux === 400000);
  check('ordinary dev bosses stay unlimited while dev calamities use the daily cap',
    /function devBossHasUnlimitedAttacks\(state, mobRow\)/.test(bossSource)
      && /state\?\.spawn_source === 'dev' && !isCalamityBoss\(mobRow\?\.name\)/.test(bossSource)
      && /const unlimitedDev = isDev && !calamity/.test(bossSource)
      && /\$\{unlimitedDev \? '' :/.test(bossSource));
  check('active dev and calamity bosses persist until defeated',
    !/CALAMITY_IDLE_MS|expireIdleCalamity|calamity-expiry|escaped after two hours/.test(bossSource)
      && /const ACTIVE_BOSS_EXPIRES_AT_SQL = "NOW\(\) \+ INTERVAL '100 years'"/.test(bossSource));
  check('Bakunawa lore has both asset aliases and a deployment-safe fallback',
    /monsters\/boss\/lore\/boss_lores\.txt/.test(bossSource)
      && /monsters\/boss\/lore\/boss\.txt/.test(bossSource)
      && /BOSS_LORE_FALLBACKS/.test(bossSource)
      && /bakunawa:/.test(bossSource));
  check('startup scheduler refreshes the active boss payload after deployment',
    /let startupPass = true/.test(bossSchedulerSource)
      && /const forceRefresh = startupPass/.test(bossSchedulerSource)
      && /tickGuild\(client, guildId, \{ forceRefresh \}\)/.test(bossSchedulerSource)
      && /forceRefresh \? 'scheduler:deployment-refresh'/.test(bossSource));
  const eclipseSim = resolveBattle(
    player({ atk: 1, hp: 100000, def: 100000, crit: 100, classPassive: null }),
    mob({
      name: 'Bakunawa', mobType: 'boss', atk: 0, hp: 100000, def: 0, crit: 0,
      skillKey: 'bakunawa_seven_moons', specialFlags: { no_immunities: true },
    }),
    { mode: 'boss', seed: 42, rng: () => 0.5 },
  );
  const round3 = eclipseSim.rounds.find((r) => r.round === 3)?.events || [];
  const round4 = eclipseSim.rounds.find((r) => r.round === 4)?.events || [];
  check('Bakunawa Eclipse applies darkened every fourth turn and suppresses crits for one turn',
    round3.some((event) => event.includes('(CRIT!)'))
      && round4.some((event) => event.includes('Bakunawa: Eclipse'))
      && round4.some((event) => event.includes('Hero attacks') && !event.includes('(CRIT!)'))
      && eclipseSim.rounds.find((r) => r.round === 5)?.events.some((event) => event.includes('(CRIT!)')));
  const weightedBossRows = [{ name: 'Jotun' }, { name: 'Medusa' }];
  check('Greater/normal weighted selection remains enabled',
    pickWeightedBoss(weightedBossRows, scripted([0.29, 0])).row.name === 'Jotun'
      && pickWeightedBoss(weightedBossRows, scripted([0.31, 0])).row.name === 'Medusa'
      && /const spawnChest = greater \|\| calamity/.test(bossSource));
  const survivingRefresh = /if \(remaining <= 0\) \{[\s\S]*?\} else \{([\s\S]*?)\n\s*\}/.exec(bossSource)?.[1] || '';
  check('surviving boss attacks schedule a coalesced progress refresh',
    /scheduleBossLiveRefresh/.test(survivingRefresh) && !/bossStatusImage/.test(survivingRefresh));
  const scheduledRefresh = /function scheduleBossLiveRefresh[\s\S]*?\/\* .*?spawn \/ escape/.exec(bossSource)?.[0] || '';
  check('scheduled boss progress refresh uses the coalesced status renderer',
    /refreshLiveMessageProgress/.test(scheduledRefresh)
      && !/refreshLiveMessage\(client, guildId\)/.test(scheduledRefresh));
  const progressRefresh = /async function refreshLiveMessageProgress[\s\S]*?\r?\n\}\r?\n\r?\nfunction scheduleBossLiveRefresh/.exec(bossSource)?.[0] || '';
  check('surviving boss attacks keep the Canvas status image',
    /includeStatusImage = bossImageRefreshEnabled\(\)/.test(progressRefresh)
      && /includeStatusImage,/.test(progressRefresh)
      && /includeBanner:\s*'remote-only'/.test(progressRefresh)
      && /BOSS_IMAGE_REFRESH_ENABLED', true/.test(bossSource));
  check('stale boss progress refreshes are lifecycle-guarded',
    /shouldApply:\s*\(view\)/.test(scheduledRefresh)
      && /view\?\.state\?\.status === 'active'/.test(scheduledRefresh)
      && /pending\.cancelled/.test(scheduledRefresh));
  check('boss final waits for an already-running progress edit',
    /await clearPendingBossRefresh\(guildId, 'dead'\)/.test(bossSource)
      && /return pending\.done/.test(bossSource));
  check('boss progress/final retain an existing local banner without re-upload',
    /existingBanner\?\.url/.test(bossSource)
      && /retainedAttachments = existingBanner\?\.id \? \[\{ id: existingBanner\.id \}\]/.test(bossSource)
      && /bannerUrl/.test(bossSource));
  check('boss recovery attaches a missing local banner exactly once',
    /needsLocalBannerAttachment = localBannerCanBeReused && !existingBanner/.test(bossSource)
      && /includeBanner:\s*needsLocalBannerAttachment \? true : options\.includeBanner/.test(bossSource));
  check('boss message recovery preserves the rendered status payload',
    /postFreshLiveMessage\(client, guildId, payload\)/.test(bossSource)
      && !/attachmentEditAttempted[\s\S]*?includeStatusImage:\s*false/.test(bossSource));

  const renderSource = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'battleRender.js'), 'utf8');
  const {
    battlePhase, shouldRenderBattleFrame, logEmbeds, battleLogNavigationRow,
  } = require(path.join(ROOT, 'src', 'engine', 'battleRender'));
  const oldRenderMode = process.env.BATTLE_FRAME_RENDER_MODE;
  const oldCooldown = process.env.BATTLE_FRAME_RENDER_COOLDOWN_MS;
  delete process.env.BATTLE_FRAME_RENDER_MODE;
  process.env.BATTLE_FRAME_RENDER_COOLDOWN_MS = '30000';
  check('battle phase keeps a zero-length battle as the opening frame', battlePhase(0, 0) === 'start');
  check('initial battle Canvas remains enabled',
    shouldRenderBattleFrame({ phase: 'start', guildId: 'g', ownerId: 'u', mode: 'raid' }).render === true);
  check('start_and_final keeps non-delivered progress frames throttled',
    shouldRenderBattleFrame({ phase: 'update', guildId: 'g', ownerId: 'u', mode: 'raid' }).render === false);
  check('final battle Canvas remains enabled',
    shouldRenderBattleFrame({ phase: 'final', guildId: 'g', ownerId: 'u', mode: 'raid' }).render === true);
  if (oldRenderMode == null) delete process.env.BATTLE_FRAME_RENDER_MODE;
  else process.env.BATTLE_FRAME_RENDER_MODE = oldRenderMode;
  if (oldCooldown == null) delete process.env.BATTLE_FRAME_RENDER_COOLDOWN_MS;
  else process.env.BATTLE_FRAME_RENDER_COOLDOWN_MS = oldCooldown;
  check('initial delivery renders frame zero in Canvas',
    /channel\.send\(\{\s*\.\.\.\(await frame\(0\)\)/.test(renderSource));
  check('raid result keeps the separate final battle Canvas',
    /const files = \[\s*\.\.\.battleImage\.files,\s*\.\.\.\(rewardsImage \? rewardsImage\.files : \[\]\)/.test(renderSource)
      && /if \(rewardsImage\) embeds\.push\(resultEmbed\)/.test(renderSource));
  check('permission fallback preserves the final Canvas payload',
    /channel\.send\(\{ \.\.\.finalPayload, attachments: undefined \}\)/.test(renderSource));

  const longBattle = {
    seed: 12345,
    winner: 'a',
    a: { name: 'Hero' },
    b: { name: 'Boss' },
    rounds: Array.from({ length: 20 }, (_, index) => ({
      round: index + 1,
      events: [`event-${index + 1}`],
    })),
  };
  const logPages = logEmbeds(longBattle);
  const descriptions = logPages.map((embed) => embed.data.description);
  check('battle log paginates at eight complete turns',
    logPages.length === 3
      && descriptions[0].includes('TURN 1') && descriptions[0].includes('TURN 8')
      && !descriptions[0].includes('TURN 9')
      && descriptions[1].includes('TURN 9') && descriptions[1].includes('TURN 16')
      && descriptions[2].includes('TURN 17') && descriptions[2].includes('TURN 20'));
  check('battle log preserves every turn from turn one in order',
    Array.from({ length: 20 }, (_, index) => `event-${index + 1}`).every((event, index) => {
      const joined = descriptions.join('\n');
      const position = joined.indexOf(event);
      const previous = index === 0 ? -1 : joined.indexOf(`event-${index}`);
      return position > previous;
    }));
  check('battle log pages stay below the safe description limit',
    descriptions.every((description) => description.length <= 3800));

  const oversizedEvent = 'x'.repeat(7600);
  const oversizedPages = logEmbeds({
    ...longBattle,
    rounds: [{ round: 1, events: [oversizedEvent] }],
  });
  check('oversized single turns continue without losing event text',
    oversizedPages.length >= 3
      && oversizedPages[0].data.description.includes('TURN 1')
      && oversizedPages.slice(1).every((embed) => embed.data.description.includes('TURN 1 (cont.)'))
      && oversizedPages.map((embed) => embed.data.description.replace(/\*\*— TURN 1(?: \(cont\.\))? —\*\*\n/g, '')).join('').length === oversizedEvent.length
      && oversizedPages.every((embed) => embed.data.description.length <= 3800));

  const firstLogNav = battleLogNavigationRow(0, 3).toJSON().components;
  const middleLogNav = battleLogNavigationRow(1, 3).toJSON().components;
  const lastLogNav = battleLogNavigationRow(2, 3).toJSON().components;
  check('battle log navigation exposes unique first/prev/count/next/last controls',
    // Five action-suffixed controls with unique custom ids (the old page-number
    // ids collided on the first/last page and made Discord drop the whole row).
    firstLogNav.length === 5
      && new Set(firstLogNav.map((c) => c.custom_id)).size === 5
      && firstLogNav.map((c) => c.custom_id).join(',')
        === 'battle_log_page:first,battle_log_page:prev,battle_log_page:count,battle_log_page:next,battle_log_page:last'
      // Bounded (no wrap): First/Previous disabled on page 1, Next/Last on the last page.
      && firstLogNav[0].disabled === true && firstLogNav[1].disabled === true
      && firstLogNav[3].disabled === false && firstLogNav[4].disabled === false
      && lastLogNav[0].disabled === false && lastLogNav[1].disabled === false
      && lastLogNav[3].disabled === true && lastLogNav[4].disabled === true
      // Every middle-page control is enabled except the disabled page counter.
      && middleLogNav.every((c) => c.disabled === false || c.custom_id === 'battle_log_page:count')
      && middleLogNav[2].custom_id === 'battle_log_page:count' && middleLogNav[2].disabled === true);
  check('battle log page controls remain collector-owned',
    /startsWith\('battle_log_page:'\)/.test(fs.readFileSync(
      path.join(ROOT, 'src', 'handlers', 'interactionHandler.js'), 'utf8'
    )));
  check('raid and boss logs share one-page ephemeral pagination',
    /showPaginatedBattleLog\(i, battleLogPages\)/.test(renderSource)
      && /showPaginatedBattleLog\(interaction, pages\)/.test(bossSource)
      && !/battleLogPages\.slice\(0, 10\)/.test(renderSource)
      && !/embeds: pages\.slice\(0, 10\)/.test(bossSource));
}

// — [Ascension §3] Sigils, Ascension costs, gacha rates —
{
  section('Ascension §3 — sigils, costs, rates');
  const {
    MAX_SIGILS, SIGIL_ESSENCE_COST, ASCENSION_COST,
    sigilMultiplier, computeSigilStats, nextSigilCost, ascensionCost,
  } = require(path.join(ROOT, 'src', 'config', 'ascension'));
  const { TIER_WEIGHTS } = require(path.join(ROOT, 'src', 'config', 'gachaRates'));

  // §3.2 — rates 64.5 / 34 / 1 / 0.5, summing to exactly 100%.
  const w = Object.fromEntries(TIER_WEIGHTS);
  check('rates: Epic 64.5%', w.Epic === 0.645);
  check('rates: Mythic 34%', w.Mythic === 0.340);
  check('rates: Legendary 1%', w.Legendary === 0.01);
  check('rates: Supreme 0.5%', w.Supreme === 0.005);
  const sum = TIER_WEIGHTS.reduce((s, [, p]) => s + p, 0);
  check('rates sum to 1.0', Math.abs(sum - 1) < 1e-9, `sum=${sum}`);

  const secureRng = require(path.join(ROOT, 'src', 'utils', 'secureRng'));
  check('secure RNG uses crypto.randomInt',
    /crypto\.randomInt\s*\(/.test(fs.readFileSync(path.join(ROOT, 'src', 'utils', 'secureRng.js'), 'utf8')));
  check('secure RNG integer helpers preserve bounds',
    secureRng.int(1) === 0
      && secureRng.range(5, 5) === 5
      && secureRng.chance(0) === false
      && secureRng.chance(1) === true
      && secureRng.weightedIndex([0, 1, 0]) === 1);
  const randomAuditFiles = [
    'config/gachaRates.js', 'config/dropRates.js', 'config/bosses.js',
    'config/raidLoot.js', 'config/runes.js', 'utils/questProgress.js',
    'utils/selectionPools.js', 'commands/rpg/enhance.js', 'commands/rpg/open.js',
    'engine/bossSystem.js',
  ];
  for (const file of randomAuditFiles) {
    const source = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
    check(`${file} has no Math.random reference`, !/Math\.random\b/.test(source));
  }

  // §3.4 — multiplier: 0 sigils = 50%, each +5%, 10/10 = 100%.
  check('sigil multiplier 0 → 0.50', sigilMultiplier(0) === 0.50);
  check('sigil multiplier 4 → 0.70', Math.abs(sigilMultiplier(4) - 0.70) < 1e-9);
  check('sigil multiplier 10 → 1.00', sigilMultiplier(10) === 1.00);
  check('sigil multiplier clamps >10', sigilMultiplier(99) === 1.00);
  const base = { base_atk: 333, base_hp: 1001, base_def: 87 };
  const at0 = computeSigilStats(base, 0);
  check('stats at 0 sigils = floor(base × 0.5)',
    at0.curr_atk === 166 && at0.curr_hp === 500 && at0.curr_def === 43, JSON.stringify(at0));
  const at10 = computeSigilStats(base, 10);
  check('stats at 10 sigils = base',
    at10.curr_atk === 333 && at10.curr_hp === 1001 && at10.curr_def === 87, JSON.stringify(at10));

  // Section 3.4 sigil totals are Epic 100, Mythic 83, Legendary 47, and Supreme 30.
  const totals = { Epic: 100, Mythic: 83, Legendary: 47, Supreme: 30 };
  for (const [tier, want] of Object.entries(totals)) {
    const got = Object.values(SIGIL_ESSENCE_COST[tier]).reduce((s, v) => s + v, 0);
    check(`sigil total ${tier} = ${want}`, got === want, `got ${got}`);
  }
  check('band Epic: sigil 1 costs 5', nextSigilCost('Epic', 0).essence === 5);
  check('band Epic: sigil 4 costs 10', nextSigilCost('Epic', 3).essence === 10);
  check('band Epic: sigil 8 costs 15', nextSigilCost('Epic', 7).essence === 15);
  check('no next sigil at 10/10', nextSigilCost('Epic', MAX_SIGILS) === null);

  // Section 3.4 ascension costs plus grand totals are 150, 123, 67, and 45 essence.
  const asc = { Epic: [50, 100000], Mythic: [40, 250000], Legendary: [20, 500000], Supreme: [15, 1000000] };
  for (const [tier, [ess, cx]] of Object.entries(asc)) {
    const c = ascensionCost(tier);
    check(`ascension ${tier} = ${ess} essence + ${cx.toLocaleString()} Credux`,
      c.essence === ess && c.credux === cx, JSON.stringify(c));
    const grand = Object.values(SIGIL_ESSENCE_COST[tier]).reduce((s, v) => s + v, 0) + c.essence;
    check(`grand total essence ${tier}`, grand === totals[tier] + ess, `got ${grand}`);
  }
  check('ASCENSION_COST covers all four tiers', Object.keys(ASCENSION_COST).length === 4);

  // §3.5/§3.6 — computed deity stats flow through assemblePlayerStats flat-added;
  // side slots contribute 50% of the SIGIL-SCALED stats.
  const deity = computeSigilStats(base, 6); // ×0.80
  const solo = assemblePlayerStats('Knight', 10, null, null, deity, null, null);
  const bare = assemblePlayerStats('Knight', 10, null, null, null, null, null);
  check('slot-1 deity adds sigil-scaled stats flat',
    solo.atk === bare.atk + deity.curr_atk && solo.hp === bare.hp + deity.curr_hp
    && solo.def === bare.def + deity.curr_def);
  const withSide = assemblePlayerStats('Knight', 10, null, null, null, null,
    { slot2: deity, slot3: null, resonance: { atkPct: 0, hpPct: 0, defPct: 0, critPts: 0 } });
  check('side slot adds 50% of sigil-scaled stats',
    withSide.atk === bare.atk + Math.floor(deity.curr_atk * 0.5)
    && withSide.hp === bare.hp + Math.floor(deity.curr_hp * 0.5)
    && withSide.def === bare.def + Math.floor(deity.curr_def * 0.5));

  // §3.6 — blessing gating: buildPlayerFighter only forwards blessing keys when
  // ascended (DB path). Static guard: the source must gate on the ascended flag.
  // The gating now lives in the shared resolveBlessingSlots() helper, which both
  // statAssembly (combat) and stats.js (display) call; guard it in its new home
  // and guard that statAssembly still delegates to it.
  const saSrc = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'statAssembly.js'), 'utf8');
  const blSrc = fs.readFileSync(path.join(ROOT, 'src', 'config', 'blessings.js'), 'utf8');
  check('slot-1 blessing gated on ascended', /slot1BlessingKey && slot1Ascended/.test(blSrc));
  check('echo blessing gated on ascended', /echoName && echoAscended/.test(blSrc));
  check('statAssembly delegates blessing resolution', /resolveBlessingSlots\(/.test(saSrc));
}

// — [Ascension §4] glossary routing (static — command + interaction wiring) —
{
  section('Ascension §4 — glossary routing');
  const glossSrc = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'rpg', 'glossary.js'), 'utf8');
  for (const cat of ['deities', 'weapons', 'armors', 'runes']) {
    check(`glossary category '${cat}' defined`, new RegExp(`${cat}:`).test(glossSrc));
  }
  check('glossary queries is_available only', /is_available = TRUE/.test(glossSrc));
  check('glossary exports execute + handleInteraction',
    /module\.exports = \{ execute, handleInteraction \}/.test(glossSrc));
  const {
    paginateEntries,
    splitBoundary,
    circularPage,
    PAGE_BODY_LIMIT,
    PAGE_ENTRY_LIMIT,
  } = require(path.join(ROOT, 'src', 'commands', 'rpg', 'glossary'));
  const shortEntries = Array.from({ length: PAGE_ENTRY_LIMIT + 1 }, (_, index) => ({
    leading: `Item ${index + 1}`,
    passiveName: `Passive ${index + 1}`,
    description: 'Complete short description.',
  }));
  const entryCountPages = paginateEntries(shortEntries);
  check('glossary keeps at most ten entries on a page',
    entryCountPages.length === 2
      && entryCountPages[0].match(/^Item /gm)?.length === PAGE_ENTRY_LIMIT);

  const longEntries = Array.from({ length: 6 }, (_, index) => ({
    leading: `Long Item ${index + 1}`,
    passiveName: `Long Passive ${index + 1}`,
    description: `${`Sentence ${index + 1}. `.repeat(70)}Ending ${index + 1}.`,
  }));
  const sizePages = paginateEntries(longEntries);
  check('glossary dynamically reduces entries to stay within its safe page budget',
    sizePages.length > 1
      && sizePages.every((body) => body.length <= PAGE_BODY_LIMIT)
      && longEntries.every((entry) => sizePages.some((body) => body.includes(entry.description))));

  const finalMarker = 'DESCRIPTION-END';
  const oversizedDescription = `${'A complete sentence stays readable. '.repeat(180)}${finalMarker}`;
  const splitPages = paginateEntries([{
    leading: 'Oversized Item',
    passiveName: 'Oversized Passive',
    description: oversizedDescription,
  }]);
  check('glossary splits oversized passive descriptions without truncating their ending',
    splitPages.length > 1
      && splitPages.every((body) => body.length <= PAGE_BODY_LIMIT)
      && splitPages.slice(1).every((body) => body.includes('Passive Description — Continued'))
      && splitPages.at(-1).includes(finalMarker)
      && !splitPages.some((body) => body.includes('...')));
  check('glossary description splitting prefers a complete word boundary',
    splitBoundary('alpha beta gamma', 8) === 'alpha '.length);
  const carouselPages = [{ body: 'first' }, { body: 'middle' }, { body: 'last' }];
  check('glossary carousel wraps in both directions after dynamic pagination',
    circularPage(carouselPages, -1).body === 'last'
      && circularPage(carouselPages, carouselPages.length).body === 'first'
      && circularPage(carouselPages, -1).totalPages === carouselPages.length);

  const cmdSrc = fs.readFileSync(path.join(ROOT, 'src', 'handlers', 'commandHandler.js'), 'utf8');
  check('crd glossary routed (IMPLEMENTED)', /glossary: \{ mw: 'full', run: glossaryCmd\.execute \}/.test(cmdSrc));
  check('glossary in COMMAND_MAP', /glossary:\s+\{ requiresCharacter: false \}/.test(cmdSrc));

  const intSrc = fs.readFileSync(path.join(ROOT, 'src', 'handlers', 'interactionHandler.js'), 'utf8');
  check('gloss namespace routed for select + buttons',
    /namespace === 'gloss'.*glossaryCmd\.handleInteraction/.test(intSrc));
  check('dsigil namespace routed', /namespace === 'dsigil'/.test(intSrc));
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
{
  const bossSource = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'bossSystem.js'), 'utf8');
  const engineSource = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'battleEngine.js'), 'utf8');
  const { bossStatusCardHeight } = require(path.join(ROOT, 'src', 'engine', 'bossSystem'));
  const bakunawa = mob({
    name: 'Bakunawa', mobType: 'boss', hp: 1000, poolHp: 1000, poolMaxHp: 1000,
    atk: 1, def: 0, skillKey: 'bakunawa_seven_moons',
    immunityTags: ['all_debuffs'], specialFlags: { no_immunities: true },
  });
  const thresholdSim = resolveBattle(
    player({ atk: 1000, hp: 100000, def: 100000, crit: 0, classPassive: null }),
    bakunawa,
    { mode: 'boss', seed: 1, rng: () => 0.5 },
  );
  check('Bakunawa crosses all six thresholds once and caps at +60% ATK',
    thresholdSim.b.bossPassiveState.atkBonusPct === 0.6
      && JSON.stringify(thresholdSim.b.bossPassiveState.crossedThresholds) === JSON.stringify([85, 70, 55, 40, 25, 10])
      && thresholdSim.bossThresholdEvents.length === 6);
  const resumed = resolveBattle(
    player({ atk: 1, hp: 100000, def: 100000, crit: 0, classPassive: null }),
    mob({ ...bakunawa, hp: 500, poolHp: 500, poolMaxHp: 1000, bossPassiveState: thresholdSim.b.bossPassiveState }),
    { mode: 'boss', seed: 2, rng: () => 0.5 },
  );
  check('Bakunawa threshold state persists without retriggering crossed thresholds',
    resumed.b.bossPassiveState.atkBonusPct === 0.6 && resumed.bossThresholdEvents.length === 0);
  check('no_immunities bypasses boss immunity gates',
    /side\.isBoss && side\.specialFlags\.no_immunities === true\) return false/.test(engineSource));
  check('boss simulation follows the row lock and omits legacy level writes',
    bossSource.indexOf('FOR UPDATE') < bossSource.indexOf('resolveBattle(fighter, boss')
      && !/boss_level|enemy_level/.test(bossSource));
  check('boss status card height follows wrapped passive line count',
    bossStatusCardHeight(1) === 190
      && bossStatusCardHeight(3) === 242
      && bossStatusCardHeight(4) === 268
      && /const passiveLineCount = Math\.max\(1, passiveLines\.length\)/.test(bossSource)
      && /const H = bossStatusCardHeight\(passiveLineCount\)/.test(bossSource)
      && /STATUS_PASSIVE_LINE_HEIGHT \* \(passiveLineCount - 1\) \+ 18/.test(bossSource));
}

console.log(`SELFTEST: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('All checks passed.');
