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
const { resolveBattle, rngOf } = require(path.join(ROOT, 'src', 'engine', 'battleEngine'));
const PASSIVE_REGISTRY = require(path.join(ROOT, 'src', 'engine', 'passiveRegistry'));
const {
  computeClassBattleStats, assemblePlayerStats, computeMobStats, computeBossStats,
} = require(path.join(ROOT, 'src', 'engine', 'statAssembly'));
const { applyCombatExp, EXP_REQUIRED, MAX_COMBAT_LEVEL } = require(path.join(ROOT, 'src', 'config', 'combatExp'));
const {
  GREATER_BOSSES, rollBossChest, hpMultiplierForChest,
  inferChestFromGreaterHp, pickWeightedBoss,
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
  // 171 unique keys total — 170 effect keys + the shared `none` no-op. [v5] added
  // 8 armor passives and 26 echo blessing keys; aegis & helm_of_darkness were
  // already counted (migrated from shields).
  check('expected key count (171 incl. none)', regKeys.size === 171, `got ${regKeys.size}`);
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
  check('Mage Lv50 ATK 5250', mage.atk === 350 + 100 * 49, `got ${mage.atk}`);
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
  check('C1: boss Lv60 uses direct DB formula without a runtime multiplier',
    boss60.hp === 82400 && boss60.atk === 6080 && boss60.def === 2230 && boss60.crit === 20,
    `got hp=${boss60.hp} atk=${boss60.atk} def=${boss60.def} crit=${boss60.crit}`);
  const sClamp = computeMobStats(blackDuwende, 99);
  check('C1: mob level clamped to 55', sClamp.hp === 2110 + 80 * 55, `got ${sClamp.hp}`);
}

// — [Jun-2026 §1] per-class distinct base + scaling (no uniform base anymore) —
{
  const L1_HP = { Swordsman: 700, Fighter: 850, Mage: 600, Knight: 1000, Archer: 600 };
  for (const cls of Object.keys(L1_HP)) {
    const s1 = computeClassBattleStats(cls, 1);
    check(`§1: ${cls} Lv1 HP = ${L1_HP[cls]}`, s1.hp === L1_HP[cls], `got ${s1.hp}`);
  }
  const L50_HP = { Swordsman: 5845, Fighter: 6730, Mage: 5010, Knight: 8350, Archer: 5745 };
  for (const cls of Object.keys(L50_HP)) {
    const stats = computeClassBattleStats(cls, 50);
    check(`§1: ${cls} Lv50 HP includes +50 HP/Lv`, stats.hp === L50_HP[cls], `got ${stats.hp}`);
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

// — Knight DR ×0.80 after mitigation —
{
  // order .9 → mob first; critPre(A) .99; mob crit .99, var .5; A var .5 (kills hp-1 mob)
  const script = [0.9, 0.99, 0.99, 0.5, 0.5];
  const sK = resolveBattle(player(), mob({ hp: 1 }), { seed: 1, rng: scripted(script) });
  check('Knight takes 45 (57 × 0.8)', dmgOf(allEvents(sK), 'strikes') === 45,
    `got ${dmgOf(allEvents(sK), 'strikes')}`);
  const sM = resolveBattle(player({ class: 'Mage', classPassive: 'overcharge' }), mob({ hp: 1 }),
    { seed: 1, rng: scripted(script) });
  check('non-Knight takes 57', dmgOf(allEvents(sM), 'strikes') === 57,
    `got ${dmgOf(allEvents(sM), 'strikes')}`);
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
}

// — Mage Overcharge: fires rounds 3/6/9, fixed ×2.5 ([v4.4], was ×3), crit suppressed —
{
  const mk = () => player({ class: 'Mage', classPassive: 'overcharge' });
  // raid draws/round: critPre, playerVar, mobCrit, mobVar. Round 3 = overcharge; its
  // crit pre-roll is forced to 0.0 (would crit) to prove the crit is voided anyway.
  const script = [0.0, /* r1 */ 0.99, 0.5, 0.99, 0.5, /* r2 */ 0.99, 0.5, 0.99, 0.5,
    /* r3 */ 0.0, 0.5, 0.99, 0.5];
  const sim = resolveBattle(mk(), mob({ hp: 100000 }), { seed: 1, rng: scripted(script) });
  // ×2.5 fixed total multiplier (no crit, no rider) → 214 × 2.5 = 535.
  check('Overcharge fires round 3 = 535 (×2.5)', dmgOf(roundEvents(sim, 3), 'attacks') === 535,
    `got ${dmgOf(roundEvents(sim, 3), 'attacks')}`);
  check('Overcharge marker on round 3', hasEvent(roundEvents(sim, 3), 'Overcharge'));
  check('no Overcharge on rounds 1/2', !hasEvent(roundEvents(sim, 1), 'Overcharge') && !hasEvent(roundEvents(sim, 2), 'Overcharge'));
  // BUG FIX: the crit pre-roll succeeds (0.0) on round 3 yet the hit must NOT crit
  check('Overcharge round 3 never crits (pre-roll latch voided)', !hasEvent(roundEvents(sim, 3), '(CRIT!)'));
  check('round 1/2 are plain hits = 214', dmgOf(roundEvents(sim, 1), 'attacks') === 214 && dmgOf(roundEvents(sim, 2), 'attacks') === 214,
    `r1=${dmgOf(roundEvents(sim, 1), 'attacks')} r2=${dmgOf(roundEvents(sim, 2), 'attacks')}`);
  // overcharge is exactly 2.5× the plain hit (linear in ATK through mitigation)
  check('Overcharge = 2.5× plain hit', dmgOf(roundEvents(sim, 3), 'attacks') === Math.floor(2.5 * dmgOf(roundEvents(sim, 1), 'attacks')));
}

// — Overcharge re-fires every 3rd round (fallback-driven; not 4/5) —
{
  const mk = () => player({ class: 'Mage', classPassive: 'overcharge', hp: 1000000 });
  const sim = resolveBattle(mk(), mob({ hp: 1000000, atk: 1 }), { seed: 1, rng: scripted([0.0]) });
  check('Overcharge re-fires round 6', hasEvent(roundEvents(sim, 6), 'Overcharge'));
  check('Overcharge re-fires round 9', hasEvent(roundEvents(sim, 9), 'Overcharge'));
  check('no Overcharge on rounds 4/5/7/8',
    !hasEvent(roundEvents(sim, 4), 'Overcharge') && !hasEvent(roundEvents(sim, 5), 'Overcharge')
    && !hasEvent(roundEvents(sim, 7), 'Overcharge') && !hasEvent(roundEvents(sim, 8), 'Overcharge'));
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
  check('skip-CC on round 3: overcharge lost (no marker, no attack)',
    !hasEvent(roundEvents(sim, 3), 'Overcharge') && !hasEvent(roundEvents(sim, 3), 'attacks'));
  check('skip-CC: no carry-over to round 4', !hasEvent(roundEvents(sim, 4), 'Overcharge'));
  check('skip-CC: next overcharge fires round 6', hasEvent(roundEvents(sim, 6), 'Overcharge'));
}

// — Overcharge suppresses crit even vs an auto-crit grant (Apollo round 12) —
{
  // Apollo grants a guaranteed crit every 4th round; round 12 is also an overcharge round
  // (12 % 3 == 0) → suppression must win. Fallback 0.5 means no NATURAL crits (crit 20 vs
  // pre-roll 50), so CRIT markers appear only on Apollo's rounds (4, 8, 12-suppressed).
  const mk = () => player({ class: 'Mage', classPassive: 'overcharge', weaponPassiveKey: 'apollos_silver_bow', hp: 1000000 });
  const sim = resolveBattle(mk(), mob({ hp: 1000000, atk: 1 }), { seed: 1, rng: scripted([0.0]) });
  check('Apollo auto-crit lands on non-overcharge round 4', hasEvent(roundEvents(sim, 4), '(CRIT!)'));
  check('Apollo auto-crit lands on non-overcharge round 8', hasEvent(roundEvents(sim, 8), '(CRIT!)'));
  check('Overcharge round 12 fires', hasEvent(roundEvents(sim, 12), 'Overcharge'));
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
  check('snapshot actions: mob debuff + immediate tick duration included',
    action?.b.title === 'Infectious Bite' && /Rot inflicted \(1 turn\)/.test(action?.b.detail || ''),
    `${action?.b.title} / ${action?.b.detail}`);
}

// DOT now ticks right after the affected side acts, before the opponent can attack.
{
  const sim = resolveBattle(
    player({ name: 'TestUser', hp: 100, def: 0, atk: 1, crit: 0 }),
    mob({ name: 'Lamia', atk: 400, skillKey: 'lamia_serpent_bite', hp: 3000 }),
    { mode: 'raid', rng: () => 0 }
  );
  const ev = roundEvents(sim, 1);
  const iAttack = ev.findIndex((e) => e.includes('TestUser attacks'));
  const iBleed = ev.findIndex((e) => e.includes('TestUser suffers 140 Bleed damage'));
  const iDeath = ev.findIndex((e) => e.includes('TestUser died from bleeding'));
  const iMob = ev.findIndex((e) => e.includes('Lamia strikes'));
  check('DOT after affected action can end fight before opponent attack',
    sim.winner === 'b' && sim.outcome === 'dot' && iAttack !== -1 && iAttack < iBleed && iBleed < iDeath && iMob === -1,
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

// [balance] Surt Muspell's Flame: Burn stacks 5%→30% ATK/turn; +50% vs an already-burning foe.
{
  const sim = resolveBattle(
    player({ deityBlessingKey: 'surt_muspells_flame', atk: 100, hp: 100000, def: 10, crit: 0 }),
    mob({ name: 'Dummy', atk: 1, hp: 100000, def: 0, crit: 0 }),
    { mode: 'raid', rng: () => 0 }
  );
  check('Surt stacks Burn and bonuses vs burning', hasEvent(allEvents(sim), 'Burn') && hasEvent(allEvents(sim), '+50% vs a burning enemy'));
}

// Attack-bound passives must not apply from the passive phase while their owner is CC-skipped.
{
  const cases = [
    [{ deityBlessingKey: 'apolaki_solar_burn' }, 'Apolaki: Solar Burn'],
    [{ deityBlessingKey: 'thor_mjolnirs_wrath' }, "Thor: Mjolnir's Wrath"],
    [{ deityBlessingKey: 'skadi_winters_hunt' }, "Skadi: Winter's Hunt"],
    [{ deityBlessingKey: 'surt_muspells_flame' }, "Surt: Muspell's Flame"],
    [{ deityBlessingKey: 'poseidon_tidal_force' }, 'Poseidon: Tidal Force'],
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

// "Next attack" bonuses stay queued through a skipped cadence turn and apply on r4.
{
  const queuedBattle = (deityBlessingKey) => resolveBattle(
    player({ deityBlessingKey, classPassive: null, atk: 100, hp: 100000, def: 0, crit: 0 }),
    player({
      name: 'Stunner', class: 'Fighter', classPassive: 'stun', atk: 1,
      hp: 100000, def: 0, crit: 0, specialFlags: { first_strike: true },
    }),
    { mode: 'duel', rng: () => 0 }
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
    hasEvent(r3, 'Burn 15% ATK/turn') && hasEvent(r3, 'Burn 20% ATK/turn'), r3.join(' | '));
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

// Final passive completion: Magwayen claims 20% max HP on defeat (in addition to her
// 15% damage drain), and Spear of Ares grants its immediate defeat stack.
{
  const rolls = [0.99, 0.99, 0.99, 0.5, 0.5]; // mob first; both hits non-crit, pinned variance
  const magwayen = resolveBattle(
    player({ classPassive: null, deityBlessingKey: 'magwayen_soul_drain', atk: 1000, hp: 1000, def: 0, crit: 0 }),
    mob({ atk: 400, hp: 100, def: 0, crit: 0 }),
    { mode: 'raid', rng: scripted(rolls) }
  );
  check('Magwayen defeat heal claims 20% max HP',
    magwayen.winner === 'a' && hasEvent(allEvents(magwayen), 'claims the fallen soul') && magwayen.a.hp > 600,
    `hp=${magwayen.a.hp}; ${allEvents(magwayen).join(' | ')}`);

  const spear = resolveBattle(
    player({ classPassive: null, weaponPassiveKey: 'spear_of_ares', atk: 1000, hp: 1000, def: 0, crit: 0 }),
    mob({ atk: 400, hp: 100, def: 0, crit: 0 }),
    { mode: 'raid', rng: scripted(rolls) }
  );
  check('Spear of Ares grants an immediate stack on defeat',
    spear.winner === 'a' && hasEvent(allEvents(spear), 'Defeat grants an immediate ATK stack'));
}

// Tyrfing's low-HP curse bypasses player evasion as well as mob evasion. Round 1 lowers
// Amihan below 30%; round 2 forces Tailwind's evade roll, which Tyrfing must override.
{
  const sim = resolveBattle(
    player({ classPassive: null, weaponPassiveKey: 'tyrfing', atk: 71, hp: 1000, def: 0, crit: 0 }),
    player({ name: 'Amihan', classPassive: null, deityBlessingKey: 'amihan_tailwind', atk: 0, hp: 100, def: 0, crit: 0 }),
    { mode: 'duel', rng: scripted([
      0.0,
      0.99, 0.99, 0.99, 0.5, 0.5,
      0.99, 0.99, 0.0, 0.5,
    ]) }
  );
  const r2 = roundEvents(sim, 2);
  check('Tyrfing curse bypasses PvP Tailwind evade below 30% HP',
    sim.winner === 'a'
      && hasEvent(r2, 'curse takes hold')
      && !hasEvent(r2, 'evades the attack (Tailwind)')
      && hasEvent(r2, 'attacks'),
    r2.join(' | '));

  const missBypass = resolveBattle(
    player({ classPassive: null, weaponPassiveKey: 'tyrfing', atk: 1, hp: 1000, def: 0, crit: 0 }),
    mob({
      hp: 100, poolHp: 20, poolMaxHp: 100, atk: 0, def: 0, crit: 0,
      skillKey: 'santelmo_will_o_wisp',
    }),
    { mode: 'raid', rng: () => 0 }
  );
  check('Tyrfing curse bypasses an armed Miss debuff',
    hasEvent(roundEvents(missBypass, 2), 'Tyrfing curse overcomes Miss')
      && hasEvent(roundEvents(missBypass, 2), 'Hero attacks'),
    roundEvents(missBypass, 2).join(' | '));
}

// — R2 + [Jun-2026 §2]: Fighter class stun 1/2 turns gates the mob's NEXT turn(s),
//   and cannot re-proc while active. The stun is applied on the player's r1 hit, so the mob still
//   ACTS r1 (directional CC never cancels an action already due) and is gated AFTER. —
{
  const mkF = () => player({ class: 'Fighter', classPassive: 'stun' });
  // A failed opening roll must stay failed — there is no first-turn forced proc.
  const noOpeningStun = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.99]) });
  check('R2: turn-1 roll obeys probability (no forced opening stun)',
    !hasEvent(roundEvents(noOpeningStun, 1), 'stuns') && hasEvent(roundEvents(noOpeningStun, 1), 'strikes'));
  // 2-turn stun on the 10% band (r1 stunPre < 0.10): mob acts r1, then skips r2+r3, acts r4.
  // Minimal script (order, r1 critPre 0.99, r1 stunPre 0.05); fallback 0.5 means no further stuns.
  const s2 = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.05]) });
  check('R2: 2-turn stun - mob ACTS r1 (CC is directional, gates next turn)', hasEvent(roundEvents(s2, 1), 'strikes'));
  check('R2: 2-turn stun — mob skips r2', hasEvent(roundEvents(s2, 2), 'unable to act'));
  check('R2: 2-turn stun — mob skips r3', hasEvent(roundEvents(s2, 3), 'unable to act'));
  check('R2: mob acts round 4', hasEvent(roundEvents(s2, 4), 'strikes'));
  // Force every stun pre-roll to proc. While the first stun is active (r2/r3), no new stun
  // is logged or refreshed; the post-expiry immunity then guarantees the mob's r4 action.
  const guarded = resolveBattle(mkF(), mob({ hp: 100000 }), { seed: 1, rng: () => 0 });
  const firstFour = [1, 2, 3, 4].flatMap((round) => roundEvents(guarded, round));
  check('R2 guard: active stun cannot re-proc or refresh',
    firstFour.filter((event) => event.includes('stuns')).length === 1,
    firstFour.join(' | '));
  check('R2 guard: post-stun immunity guarantees a free r4 action', hasEvent(roundEvents(guarded, 4), 'strikes'));
  let forcedWorst = 0, forcedStreak = 0, forcedFreeActions = 0;
  for (const battleRound of guarded.rounds) {
    if (hasEvent(battleRound.events, 'Dummy is unable to act')) {
      forcedStreak += 1;
      forcedWorst = Math.max(forcedWorst, forcedStreak);
    } else {
      forcedStreak = 0;
      if (hasEvent(battleRound.events, 'Dummy strikes')) forcedFreeActions += 1;
    }
  }
  check('R2 guard: forced-proc stream cannot create unlimited stun',
    forcedWorst <= 2 && forcedFreeActions >= 1,
    `worst=${forcedWorst}, freeActions=${forcedFreeActions}`);
  // The central guard also blocks another source from refreshing Fighter's active stun.
  const mixedStuns = resolveBattle(
    player({ class: 'Fighter', classPassive: 'stun', deityBlessingKey: 'poseidon_tidal_force', atk: 5 }),
    mob({ hp: 100000 }),
    { seed: 1, rng: () => 0 }
  );
  const mixedFirstFour = [1, 2, 3, 4].flatMap((round) => roundEvents(mixedStuns, round));
  check('R2 guard: Poseidon cannot refresh a Fighter stun',
    mixedFirstFour.filter((event) => event.includes('blow stuns')).length === 1
      && hasEvent(roundEvents(mixedStuns, 4), 'strikes'),
    mixedFirstFour.join(' | '));
  // 1-turn band (0.10 ≤ r < 0.25): mob acts r1, skips r2, acts r3.
  const s1 = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.20]) });
  check('R2: 1-turn stun - skips r2 only', hasEvent(roundEvents(s1, 1), 'strikes') && hasEvent(roundEvents(s1, 2), 'unable to act') && hasEvent(roundEvents(s1, 3), 'strikes'));
  // Dizzy's former 50% value governed its miss PROC chance. A 0.20 roll used to miss;
  // under the new 15% chance it must attack normally.
  const dizzyNerf = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.20, 0.5, 0.20, 0.99, 0.5]) });
  check('Fighter Dizzy miss chance is 15% (0.20 no longer misses)',
    hasEvent(roundEvents(dizzyNerf, 1), 'overcomes Dizzy')
      && !hasEvent(roundEvents(dizzyNerf, 1), 'misses its attack due to Dizzy'));
  // stun-immune boss: no stun ever, mob acts round 1
  const sImm = resolveBattle(mkF(), mob({ hp: 100000, immunityTags: ['stun'] }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.05]) });
  check('R2: stun negated vs stun-immune', hasEvent(roundEvents(sImm, 1), 'strikes'));
}

// — Fighter stun: proc-rate sim (~N seeded battles) + anti-lock guard —
// Round 1 is a clean Bernoulli draw of the stun band: the target is never already-stunned
// nor in the post-stun immunity window on turn 1, so the guard never interferes and the
// observed round-1 rate equals the raw pre-roll bands (15% 1-turn, 10% 2-turn).
{
  const N = 4000;
  let band1 = 0, band2 = 0;
  for (let s = 1; s <= N; s += 1) {
    const sim = resolveBattle(
      player({ class: 'Fighter', classPassive: 'stun', atk: 10 }),
      mob({ hp: 1_000_000, def: 0 }),
      { seed: s }
    );
    const r1 = roundEvents(sim, 1);
    if (hasEvent(r1, 'for 2 turns!')) band2 += 1;
    else if (hasEvent(r1, 'for 1 turn!')) band1 += 1;
  }
  const p1 = band1 / N, p2 = band2 / N;
  console.log(`   proc-rate over ${N} battles (round 1): 1-turn=${(p1 * 100).toFixed(1)}% (exp 15%), 2-turn=${(p2 * 100).toFixed(1)}% (exp 10%)`);
  check('stun 1-turn band ≈ 15%', Math.abs(p1 - 0.15) < 0.03, `got ${(p1 * 100).toFixed(1)}%`);
  check('stun 2-turn band ≈ 10%', Math.abs(p2 - 0.10) < 0.03, `got ${(p2 * 100).toFixed(1)}%`);

  // Anti-lock: a max-duration 2-turn stun skips 2 rounds, then the 1-round immunity window
  // guarantees a free action → the mob can never be skip-locked for 3+ consecutive rounds.
  // Scan every seed for the worst streak; before the fix this ran unbounded.
  let worstOverall = 0;
  for (let s = 1; s <= 200; s += 1) {
    const longSim = resolveBattle(
      player({ class: 'Fighter', classPassive: 'stun', atk: 5 }),
      mob({ hp: 5_000_000, def: 0 }),
      { seed: s }
    );
    let streak = 0;
    for (const r of longSim.rounds) {
      if (hasEvent(r.events, 'unable to act')) { streak += 1; worstOverall = Math.max(worstOverall, streak); }
      else streak = 0;
    }
  }
  console.log(`   worst consecutive stun-skip streak across 200 battles: ${worstOverall} rounds`);
  check('anti-lock: mob never skip-locked 3+ consecutive rounds', worstOverall < 3, `streak ${worstOverall}`);
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
  const sim = resolveBattle(mkB(), mob({ hp: 100000, skillKey: 'lamia_serpent_bite' }),
    { seed: 1, rng: scripted([0.0, 0.99, /* lamia */ 0.01, 0.5, 0.99, 0.5, /* r2 */ 0.99, /* lamia r2 */ 0.99, 0.5]) });
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
  check('instakill logs boss block reason', hasEvent(allEvents(sBoss), 'disabled against bosses'));
  const sDuel = resolveBattle(mkK(), player({ name: 'Rival', hp: 100000 }),
    { mode: 'duel', seed: 1, rng: scripted([0.0, 0.99, 0.99, 0.01, 0.5, 0.5]) });
  check('instakill disabled in duels', sDuel.outcome !== 'instakill');
  check('instakill logs duel block reason', hasEvent(allEvents(sDuel), 'disabled in duels'));
}

// — rupture / hemorrhage: land on mobs, hard-blocked vs all bosses —
{
  const mkR = () => player({ weaponPassiveKey: 'badiang_stalk' });
  const sMob = resolveBattle(mkR(), mob({ hp: 10000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.01, 0.5]) });
  check('rupture bursts mob for 10% maxHP (1000)', hasEvent(roundEvents(sMob, 1), 'Rupture bursts') && hasEvent(roundEvents(sMob, 1), '1000'));
  const sBoss = resolveBattle(mkR(), mob({ hp: 10000, mobType: 'boss' }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.01, 0.5]) });
  check('rupture auto-blocked vs boss', !hasEvent(allEvents(sBoss), 'Rupture'));
  const mkH = () => player({ weaponPassiveKey: 'gusisnautar' });
  const hMob = resolveBattle(mkH(), mob({ hp: 10000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.01, 0.5]) });
  check('hemorrhage tears mob', hasEvent(roundEvents(hMob, 1), 'Hemorrhage tears'));
  const hBoss = resolveBattle(mkH(), mob({ hp: 10000, mobType: 'boss' }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.01, 0.5]) });
  check('hemorrhage auto-blocked vs boss', !hasEvent(allEvents(hBoss), 'Hemorrhage'));
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

// — Mantle of Bathala: +5% HP/DEF per turn, hard-capped at +50% —
{
  const sim = resolveBattle(
    player({ atk: 0, hp: 1000, def: 100, armorPassiveKey: 'mantle_of_bathala' }),
    mob({ atk: 0, hp: 1000, def: 100 }),
    { seed: 23 }
  );
  const mantleEvents = allEvents(sim).filter((e) => e.includes('Mantle of Bathala'));
  const maxLoggedPct = Math.max(...mantleEvents.map((e) => Number(/\+(\d+)%/.exec(e)?.[1] || 0)));
  check('Mantle of Bathala caps max HP at +50%', sim.a.maxHp === 1500, `maxHp=${sim.a.maxHp}`);
  check('Mantle of Bathala never logs above +50%', maxLoggedPct === 50, `max=${maxLoggedPct}%`);
  check('Mantle of Bathala remains capped after turn 10',
    hasEvent(roundEvents(sim, 11), '+50% HP/DEF') && !hasEvent(roundEvents(sim, 11), '+55% HP/DEF'));
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

// — R3: a fully evaded hit consumes nothing (gridr evade ≠ heimdall consume) —
{
  const mk = () => player({ class: 'Mage', classPassive: 'overcharge', weaponPassiveKey: 'gridr_iron_gloves', deityBlessingKey: 'heimdall_eternal_vigilance' });
  // order .9 → mob first. r1: critPre .99, gridr 0.01 (evade ON); mob crit .99 var .5 → negated; A var .5
  // r2: critPre .99, gridr .99 (off); mob crit .99 var .5 → heimdall halves 57 → 28
  const sim = resolveBattle(mk(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.9, 0.99, 0.01, 0.99, 0.5, 0.5, /* r2 */ 0.99, 0.99, 0.99, 0.5, 0.5]) });
  check('R3: gridr evades the r1 hit', hasEvent(roundEvents(sim, 1), 'Ironhide'));
  check('R3: heimdall NOT consumed by the evaded hit', hasEvent(roundEvents(sim, 2), 'Heimdall negates'));
  check('R3: heimdall halves r2 hit to 28', dmgOf(roundEvents(sim, 2), 'strikes') === 28,
    `got ${dmgOf(roundEvents(sim, 2), 'strikes')}`);
}

// — combat EXP curve (§17): within-level semantics, multi-level, cap 50 —
{
  check('expRequired covers exactly levels 1..49', Object.keys(EXP_REQUIRED).length === 49 && MAX_COMBAT_LEVEL === 50);
  const a = applyCombatExp(1, 0, 100);
  check('exp: 1→2 at exactly 100', a.level === 2 && a.exp === 0 && a.leveledUp, JSON.stringify(a));
  const b = applyCombatExp(1, 0, 850);
  check('exp: multi-level 1→4 (100+250+500)', b.level === 4 && b.exp === 0, JSON.stringify(b));
  const c = applyCombatExp(1, 50, 100);
  check('exp: within-level carry (50+100 → L2, 50 over)', c.level === 2 && c.exp === 50, JSON.stringify(c));
  const d = applyCombatExp(10, 0, 11999);
  check('exp: no level below threshold (10→11 needs 12000)', d.level === 10 && d.exp === 11999 && !d.leveledUp, JSON.stringify(d));
  const e = applyCombatExp(49, 0, 15000000);
  check('exp: 49→50 cap reached', e.level === 50 && e.exp === 0, JSON.stringify(e));
  const f = applyCombatExp(50, 0, 999999);
  check('exp: level 50 never levels further', f.level === 50 && !f.leveledUp, JSON.stringify(f));
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

// ════════════════════════════════════════════════════════════════════════════
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
  check('same-spawn upsert resets the daily counter', /attacks = CASE[\s\S]*?ELSE 1[\s\S]*?last_daily_reset =/.test(bossSource));
  check('no lifetime per-spawn attack gate remains', !/SELECT attacks FROM boss_attack_log WHERE boss_spawn_id/.test(bossSource));
  check('boss spawn stats come directly from the mob_roster formula',
    /const stats = computeBossStats\(row, level\);/.test(bossSource)
      && /const maxHp = Math\.floor\(stats\.hp \* hpMultiplier\);/.test(bossSource));
  check('boss spawn path has no global or ATK/DEF stat multiplier',
    !/scaledBossStats|bossStatMultiplier|bossAttackDefenseMultiplier|BOSS_STAT_MULTIPLIER|BOSS_ATK_DEF_MULTIPLIER/.test(bossSource)
      && !/stats\.(?:atk|def|crit)\s*\*/.test(bossSource));
  check('Greater HP multiplier follows the rolled chest only',
    hpMultiplierForChest(rollBossChest('Jotun', () => 0.99)) === 1.5
      && hpMultiplierForChest(rollBossChest('Jotun', () => 0)) === 2
      && hpMultiplierForChest({ column: 'boss_treasure_chest', qty: 1 }) === 1
      && inferChestFromGreaterHp(100, 150)?.column === 'boss_treasure_chest'
      && inferChestFromGreaterHp(101, 202)?.column === 'boss_golden_chest'
      && inferChestFromGreaterHp(100, 100) === null
      && /const hpMultiplier = greater \? hpMultiplierForChest\(spawnChest\) : 1;/.test(bossSource)
      && /GREATER_TREASURE_HP_MULTIPLIER\s*=\s*1\.5/.test(bossConfigSource)
      && /GREATER_GOLDEN_HP_MULTIPLIER\s*=\s*2/.test(bossConfigSource));
  check('Greater chest outcome is recoverable from persisted max HP after restart',
    /inferChestFromGreaterHp\(baseHp, maxHp\) \|\| rollBossChest/.test(bossSource)
      && /RETURNING mob_id, boss_level, max_hp/.test(bossSource));
  check('Greater identity and chest rewards remain configured',
    GREATER_BOSSES.size === 5
      && rollBossChest('Jotun', () => 0).column === 'boss_golden_chest'
      && rollBossChest('Jotun', () => 0.99).qty === 2
      && rollBossChest('Medusa', () => 0).qty === 1);
  const weightedBossRows = [{ name: 'Jotun' }, { name: 'Medusa' }];
  check('Greater/normal weighted selection remains enabled',
    pickWeightedBoss(weightedBossRows, scripted([0.1, 0])).row.name === 'Jotun'
      && pickWeightedBoss(weightedBossRows, scripted([0.5, 0])).row.name === 'Medusa');
  const survivingRefresh = /if \(remaining <= 0\) \{[\s\S]*?\} else \{([\s\S]*?)\n\s*\}/.exec(bossSource)?.[1] || '';
  check('surviving boss attacks schedule a coalesced progress refresh',
    /scheduleBossLiveRefresh/.test(survivingRefresh) && !/bossStatusImage/.test(survivingRefresh));
  const scheduledRefresh = /function scheduleBossLiveRefresh[\s\S]*?\/\* .*?spawn \/ escape/.exec(bossSource)?.[0] || '';
  check('scheduled boss progress refresh uses the coalesced status renderer',
    /refreshLiveMessageProgress/.test(scheduledRefresh)
      && !/refreshLiveMessage\(client, guildId\)/.test(scheduledRefresh));
  const progressRefresh = /async function refreshLiveMessageProgress[\s\S]*?\n\}\n\nfunction scheduleBossLiveRefresh/.exec(bossSource)?.[0] || '';
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
  const { battlePhase, shouldRenderBattleFrame } = require(path.join(ROOT, 'src', 'engine', 'battleRender'));
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
}

// — [Ascension §3] Sigils, Ascension costs, gacha rates —
{
  section('Ascension §3 — sigils, costs, rates');
  const {
    MAX_SIGILS, SIGIL_ESSENCE_COST, ASCENSION_COST,
    sigilMultiplier, computeSigilStats, nextSigilCost, ascensionCost,
  } = require(path.join(ROOT, 'src', 'config', 'ascension'));
  const { TIER_WEIGHTS } = require(path.join(ROOT, 'src', 'config', 'gachaRates'));

  // §3.2 — rates 64.5 / 34.4 / 1 / 0.1, summing to exactly 100%.
  const w = Object.fromEntries(TIER_WEIGHTS);
  check('rates: Epic 64.5%', w.Epic === 0.645);
  check('rates: Mythic 34.4%', w.Mythic === 0.344);
  check('rates: Legendary 1%', w.Legendary === 0.01);
  check('rates: Supreme 0.1%', w.Supreme === 0.001);
  const sum = TIER_WEIGHTS.reduce((s, [, p]) => s + p, 0);
  check('rates sum to 1.0', Math.abs(sum - 1) < 1e-9, `sum=${sum}`);

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

  // §3.4 — sigil cost bands + column totals (Epic 100 · Mythic 83 · Legendary 60 · Supreme 30).
  const totals = { Epic: 100, Mythic: 83, Legendary: 60, Supreme: 30 };
  for (const [tier, want] of Object.entries(totals)) {
    const got = Object.values(SIGIL_ESSENCE_COST[tier]).reduce((s, v) => s + v, 0);
    check(`sigil total ${tier} = ${want}`, got === want, `got ${got}`);
  }
  check('band Epic: sigil 1 costs 5', nextSigilCost('Epic', 0).essence === 5);
  check('band Epic: sigil 4 costs 10', nextSigilCost('Epic', 3).essence === 10);
  check('band Epic: sigil 8 costs 15', nextSigilCost('Epic', 7).essence === 15);
  check('no next sigil at 10/10', nextSigilCost('Epic', MAX_SIGILS) === null);

  // §3.4 — ascension costs + grand totals (150 / 123 / 90 / 45 essence).
  const asc = { Epic: [50, 100000], Mythic: [40, 250000], Legendary: [30, 500000], Supreme: [15, 1000000] };
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
  const saSrc = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'statAssembly.js'), 'utf8');
  check('slot-1 blessing gated on ascended', /r\.blessing_key && r\.d1_ascended/.test(saSrc));
  check('echo blessing gated on ascended', /r\.echo_deity_name && r\.echo_ascended/.test(saSrc));
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
console.log(`SELFTEST: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('All checks passed.');
