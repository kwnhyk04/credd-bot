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
  computeClassBattleStats, assemblePlayerStats, computeMobStats,
} = require(path.join(ROOT, 'src', 'engine', 'statAssembly'));
const { applyCombatExp, EXP_REQUIRED, MAX_COMBAT_LEVEL } = require(path.join(ROOT, 'src', 'config', 'combatExp'));

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

// — Idiyanale double is a GUARANTEED crit-level hit that TAKES the damage% rider:
//   ×2.0 base + damage%. So plain → ×2.0; Supreme 50% + double → ×2.5. Fires every 5th turn. —
{
  const script = [0.0]; // order → A first
  for (let r = 0; r < 5; r++) script.push(0.99, 0.5, 0.99, 0.5); // critPre(no), Avar(1.0), mobCrit(no), mobVar
  // plain player: the round-5 attack is ×2.0 (crit-level base, no rider), tagged (Double!)
  const simA = resolveBattle(player({ crit: 0, deityBlessingKey: 'idiyanale_persistence', hp: 1000000 }),
    mob({ hp: 1000000, atk: 1 }), { seed: 1, rng: scripted(script) });
  const base = dmgOf(roundEvents(simA, 1), 'attacks');
  const r5 = dmgOf(roundEvents(simA, 5), 'attacks');
  check('Idiyanale round 5 marked Double', hasEvent(roundEvents(simA, 5), 'Double'));
  check('Idiyanale double = 2× a normal hit', Math.abs(r5 - base * 2) <= 1, `got ${r5} vs ${base * 2}`);
  // Supreme 50% STACKS with the double → ×2.5 (2.0 + 0.5), proportional to the ×1.5 normal.
  const simB = resolveBattle(player({ crit: 0, bonusDmgPct: 50, deityBlessingKey: 'idiyanale_persistence', hp: 1000000 }),
    mob({ hp: 1000000, atk: 1 }), { seed: 1, rng: scripted(script) });
  const b1 = dmgOf(roundEvents(simB, 1), 'attacks'); // ×1.5 (normal + 50%)
  const b5 = dmgOf(roundEvents(simB, 5), 'attacks'); // ×2.5 (double 2.0 + 50%)
  check('Supreme + double stacks to ×2.5', Math.abs(b5 - Math.floor((b1 / 1.5) * 2.5)) <= 1, `got ${b5} vs ${Math.floor((b1 / 1.5) * 2.5)}`);
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

// Poseidon Tidal Force applies after the attack for turn flow: proc on turn 4,
// target loses its next turn (turn 5), not the current turn.
{
  const sim = resolveBattle(
    player({ deityBlessingKey: 'poseidon_tidal_force', atk: 20, hp: 100000, def: 10, crit: 0 }),
    mob({ name: 'Dummy', atk: 1, hp: 100000, def: 0, crit: 0 }),
    { mode: 'raid', rng: () => 0 }
  );
  const r4 = roundEvents(sim, 4);
  const r5 = roundEvents(sim, 5);
  check('Poseidon stun is delayed to target next turn',
    hasEvent(r4, 'Poseidon: Tidal Force') && hasEvent(r4, 'Dummy strikes') && !hasEvent(r4, 'Dummy is unable to act') && hasEvent(r5, 'Dummy is unable to act'),
    `r4=${r4.join(' | ')} r5=${r5.join(' | ')}`);
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
}

// — R2 + [Jun-2026 §2]: Fighter class stun 1/2 turns gates the mob's NEXT turn(s),
//   refresh-don't-extend. The stun is applied on the player's r1 hit, so the mob still
//   ACTS r1 (directional CC never cancels an action already due) and is gated AFTER. —
{
  const mkF = () => player({ class: 'Fighter', classPassive: 'stun' });
  // 2-turn stun on the 10% band (r1 stunPre < 0.10): mob acts r1, then skips r2+r3, acts r4.
  // Minimal script (order, r1 critPre 0.99, r1 stunPre 0.05); fallback 0.5 means no further stuns.
  const s2 = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.05]) });
  check('R2: 2-turn stun - mob ACTS r1 (CC is directional, gates next turn)', hasEvent(roundEvents(s2, 1), 'strikes'));
  check('R2: 2-turn stun — mob skips r2', hasEvent(roundEvents(s2, 2), 'unable to act'));
  check('R2: 2-turn stun — mob skips r3', hasEvent(roundEvents(s2, 3), 'unable to act'));
  check('R2: mob acts round 4', hasEvent(roundEvents(s2, 4), 'strikes'));
  // re-proc a 2-turn stun in r2 (player's r2 hit) → refresh to max(remaining,2)=2 → still
  // skips r2+r3, acts r4 (extend semantics would stack to 3 and delay to r5).
  const sR = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.05, 0.5, 0.99, 0.5, /* r2 */ 0.99, 0.05]) });
  check('R2 refresh: skips r3', hasEvent(roundEvents(sR, 3), 'unable to act'));
  check('R2 refresh-not-extend: acts r4', hasEvent(roundEvents(sR, 4), 'strikes'));
  // 1-turn band (0.10 ≤ r < 0.35): mob acts r1, skips r2, acts r3.
  const s1 = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.20]) });
  check('R2: 1-turn stun - skips r2 only', hasEvent(roundEvents(s1, 1), 'strikes') && hasEvent(roundEvents(s1, 2), 'unable to act') && hasEvent(roundEvents(s1, 3), 'strikes'));
  // stun-immune boss: no stun ever, mob acts round 1
  const sImm = resolveBattle(mkF(), mob({ hp: 100000, immunityTags: ['stun'] }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.05]) });
  check('R2: stun negated vs stun-immune', hasEvent(roundEvents(sImm, 1), 'strikes'));
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
  const mkS = () => player({ hp: 10, deityBlessingKey: 'sidapa_deaths_reprieve' });
  const sim = resolveBattle(mkS(), mob({ hp: 100000, atk: 10000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.5, 0.99, 0.5, /* r2 */ 0.99, 0.5, 0.99, 0.5]) });
  check('Sidapa reprieve fires round 1', hasEvent(roundEvents(sim, 1), "Death's Reprieve"));
  check('Sidapa: second lethal kills (once per battle)', sim.winner === 'b' && sim.rounds.length === 2,
    `winner=${sim.winner} rounds=${sim.rounds.length}`);
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
  check('same-spawn upsert resets the daily counter', /attacks = CASE[\s\S]*?ELSE 1[\s\S]*?last_daily_reset =/.test(bossSource));
  check('no lifetime per-spawn attack gate remains', !/SELECT attacks FROM boss_attack_log WHERE boss_spawn_id/.test(bossSource));
  const survivingRefresh = /else if \(bossImageRefreshEnabled\(\)\) \{([\s\S]*?)\n\s*\} else \{/.exec(bossSource)?.[1] || '';
  check('surviving boss attacks use the configured image debounce',
    /scheduleBossLiveRefresh/.test(survivingRefresh) && !/await refreshLiveMessage/.test(survivingRefresh));
  const renderSource = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'battleRender.js'), 'utf8');
  const executableRenderSource = renderSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const renderedFrameCalls = [...executableRenderSource.matchAll(/\bframe\s*\(\s*([^)]+?)\s*\)/g)]
    .map((match) => match[1].trim());
  check('battle delivery invokes only the initial and final rendered frames',
    renderedFrameCalls.length === 2
      && renderedFrameCalls[0] === '0'
      && renderedFrameCalls[1] === 'finalIndex');
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
