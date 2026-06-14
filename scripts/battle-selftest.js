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
    bonusDmgPct: 0, bonusCritDmgPct: 0,
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
  const md = fs.readFileSync(path.join(ROOT, 'passive_registry_keys.md'), 'utf8');
  const mdKeys = new Set();
  for (const m of md.matchAll(/^- `([a-z0-9_]+)`/gm)) mdKeys.add(m[1]);
  const regKeys = new Set(Object.keys(PASSIVE_REGISTRY));

  const missing = [...mdKeys].filter((k) => !regKeys.has(k));
  const extra = [...regKeys].filter((k) => !mdKeys.has(k));
  check('every md key implemented', missing.length === 0, `missing: ${missing.join(', ')}`);
  check('no unlisted registry keys', extra.length === 0, `extra: ${extra.join(', ')}`);
  // 137 unique keys total — 136 effect keys + the shared `none` no-op (the md
  // lists `none` in both the weapon and mob sections; the registry is one flat object)
  check('expected key count (137 incl. none)', regKeys.size === 137, `got ${regKeys.size}`);
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

// — crit caps / class stats (R6) —
{
  const archer = computeClassBattleStats('Archer', 50);
  check('R6: Archer Lv50 class crit = 39.3', Math.abs(archer.crit - 39.3) < 1e-9, `got ${archer.crit}`);
  const knight = computeClassBattleStats('Knight', 50);
  check('Knight crit stays 5.0 (0 growth)', Math.abs(knight.crit - 5.0) < 1e-9, `got ${knight.crit}`);
  const tot = assemblePlayerStats('Archer', 50, { curr_atk: 0, curr_hp: 0, curr_def: 0, crit: 10 }, null);
  check('total crit hard cap 45', Math.abs(tot.crit - 45) < 1e-9, `got ${tot.crit}`);
  const mage = computeClassBattleStats('Mage', 50);
  check('Mage Lv50 ATK 696', mage.atk === 10 + 14 * 49, `got ${mage.atk}`);
}

// — C1: mob formula base + per_level × level (live DB rows, v4.2 §15) —
{
  // 1e: fixtures pinned to the authoritative live mob_roster export (supersedes the
  // stale seed figures AND the interim §15 +500 HP column).
  // [v4.3] per-level scaling REDUCED: regular 40/15/10 → 20/8/5; elite 75/30/16 → 40/15/10.
  // Formula is base + per_level × level (C1 — NOT level−1), so Lv1 reflects one level of growth.
  const blackDuwende = { base_hp: 1610, base_atk: 118, base_def: 78, base_crit: 5, hp_per_level: 20, atk_per_level: 8, def_per_level: 5 };
  const s1 = computeMobStats(blackDuwende, 1);
  check('C1: Black Duwende Lv1 = 1630/126/83', s1.hp === 1630 && s1.atk === 126 && s1.def === 83,
    `got hp=${s1.hp} atk=${s1.atk} def=${s1.def}`);
  // elite per-level 40/15/10 [v4.3]
  const manananggal = { base_hp: 2450, base_atk: 172, base_def: 140, base_crit: 10, hp_per_level: 40, atk_per_level: 15, def_per_level: 10 };
  const e1 = computeMobStats(manananggal, 1);
  check('C1: Manananggal Lv1 = 2490/187/150', e1.hp === 2490 && e1.atk === 187 && e1.def === 150,
    `got hp=${e1.hp} atk=${e1.atk} def=${e1.def}`);
  // boss rows are authored and untouched by the rescale
  const boss = { base_hp: 5000, base_atk: 400, base_def: 250, base_crit: 10, hp_per_level: 150, atk_per_level: 12, def_per_level: 8 };
  const s40 = computeMobStats(boss, 40);
  check('C1: boss Lv40 spot check', s40.hp === 11000 && s40.atk === 880 && s40.def === 570,
    `got hp=${s40.hp} atk=${s40.atk} def=${s40.def}`);
  const sClamp = computeMobStats(blackDuwende, 99);
  check('C1: mob level clamped to 55', sClamp.hp === 1610 + 20 * 55, `got ${sClamp.hp}`);
}

// — 1d: class base HP 500 (v4.2); per-level growth unchanged —
{
  for (const cls of ['Swordsman', 'Fighter', 'Mage', 'Knight', 'Archer']) {
    const s1 = computeClassBattleStats(cls, 1);
    check(`1d: ${cls} Lv1 HP = 500`, s1.hp === 500, `got ${s1.hp}`);
  }
  const knight = computeClassBattleStats('Knight', 50);
  check('1d: Knight Lv50 HP = 500 + 15×49 = 1235', knight.hp === 1235, `got ${knight.hp}`);
  const mage = computeClassBattleStats('Mage', 50);
  check('1d: Mage Lv50 HP = 500 + 10×49 = 990', mage.hp === 990, `got ${mage.hp}`);
}

// — Katana ×2.30 vs base ×2.00 (forced crit, pinned variance) —
{
  // draws: order(0→A first), critPre(0→crit), variance(0.5→×1.0)
  const sK = resolveBattle(player({ weaponPassiveKey: 'katana' }), mob({ hp: 1 }),
    { seed: 1, rng: scripted([0.0, 0.0, 0.5]) });
  check('katana crit = 492 (×2.30)', dmgOf(allEvents(sK), 'attacks') === 492,
    `got ${dmgOf(allEvents(sK), 'attacks')}`);
  const sN = resolveBattle(player(), mob({ hp: 1 }),
    { seed: 1, rng: scripted([0.0, 0.0, 0.5]) });
  check('base crit = 428 (×2.00)', dmgOf(allEvents(sN), 'attacks') === 428,
    `got ${dmgOf(allEvents(sN), 'attacks')}`);
}

// — Supreme riders: +50% flat always; +50% crit dmg only on crit (other source) —
{
  // crit 0 weapon; Artemis grants the first-attack auto-crit (the "other source")
  const mk = () => player({ crit: 0, bonusDmgPct: 50, bonusCritDmgPct: 50, deityBlessingKey: 'artemis_huntress_precision' });
  // r1 draws: order 0, critPre .99 (no natural crit), variance .5; mob: crit .99, var .5; r2: critPre .99, var .5
  const sim = resolveBattle(mk(), mob({ hp: 10000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.5, 0.99, 0.5, 0.99, 0.5]) });
  const r1 = dmgOf(roundEvents(sim, 1), 'attacks');
  const r2 = dmgOf(roundEvents(sim, 2), 'attacks');
  check('Supreme auto-crit hit = 803 (×2.5 ×1.5)', r1 === 803, `got ${r1}`);
  check('Supreme non-crit hit = 321 (×1.5 only)', r2 === 321, `got ${r2}`);
  check('round 1 marked CRIT', hasEvent(roundEvents(sim, 1), '(CRIT!)'));
  check('round 2 not marked CRIT', !hasEvent(roundEvents(sim, 2), '(CRIT!)'));
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

// — [v4.2] Mage Overcharge: fires rounds 3/6/9, flat +200%, crit fully suppressed —
{
  const mk = () => player({ class: 'Mage', classPassive: 'overcharge' });
  // raid draws/round: critPre, playerVar, mobCrit, mobVar. Round 3 = overcharge; its
  // crit pre-roll is forced to 0.0 (would crit) to prove the crit is voided anyway.
  const script = [0.0, /* r1 */ 0.99, 0.5, 0.99, 0.5, /* r2 */ 0.99, 0.5, 0.99, 0.5,
    /* r3 */ 0.0, 0.5, 0.99, 0.5];
  const sim = resolveBattle(mk(), mob({ hp: 100000 }), { seed: 1, rng: scripted(script) });
  // +200% ATK applied PRE-mitigation → mitigated(300×3, 80) = 642 (exactly 3× the plain
  // hit), NOT a raw flat spike. Regression guard against the unmitigated-flat bug.
  check('Overcharge fires round 3 = 642 (×3 ATK, mitigated)', dmgOf(roundEvents(sim, 3), 'attacks') === 642,
    `got ${dmgOf(roundEvents(sim, 3), 'attacks')}`);
  check('Overcharge marker on round 3', hasEvent(roundEvents(sim, 3), 'Overcharge'));
  check('no Overcharge on rounds 1/2', !hasEvent(roundEvents(sim, 1), 'Overcharge') && !hasEvent(roundEvents(sim, 2), 'Overcharge'));
  // BUG FIX: the crit pre-roll succeeds (0.0) on round 3 yet the hit must NOT crit
  check('Overcharge round 3 never crits (pre-roll latch voided)', !hasEvent(roundEvents(sim, 3), '(CRIT!)'));
  check('round 1/2 are plain hits = 214', dmgOf(roundEvents(sim, 1), 'attacks') === 214 && dmgOf(roundEvents(sim, 2), 'attacks') === 214,
    `r1=${dmgOf(roundEvents(sim, 1), 'attacks')} r2=${dmgOf(roundEvents(sim, 2), 'attacks')}`);
  // overcharge is exactly 3× the plain hit (linear in ATK through mitigation)
  check('Overcharge = 3× plain hit', dmgOf(roundEvents(sim, 3), 'attacks') === 3 * dmgOf(roundEvents(sim, 1), 'attacks'));
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

// — Overcharge lost when skip-CC'd on a multiple of 3; next fires round 6 —
{
  // Santelmo applies a 1-turn skip on its proc; script the proc to land ONLY on round 3.
  const mk = () => player({ class: 'Mage', classPassive: 'overcharge', hp: 100000 });
  // draws/round (Mage + santelmo mob): critPre, santelmoProc, playerVar, mobCrit, mobVar
  // (round 3 the player is skipped → no playerVar that round).
  const script = [0.0,
    /* r1 */ 0.99, 0.99, 0.5, 0.99, 0.5,
    /* r2 */ 0.99, 0.99, 0.5, 0.99, 0.5,
    /* r3 */ 0.99, 0.01, 0.99, 0.5,            // santelmo procs → player skips this round
    /* r4 */ 0.99, 0.99, 0.5, 0.99, 0.5,
    /* r5 */ 0.99, 0.99, 0.5, 0.99, 0.5,
    /* r6 */ 0.99, 0.99, 0.5, 0.99, 0.5];
  const sim = resolveBattle(mk(), mob({ hp: 100000, skillKey: 'santelmo_will_o_wisp' }),
    { seed: 1, rng: scripted(script) });
  check('skip-CC on round 3: player unable to act', hasEvent(roundEvents(sim, 3), 'unable to act'));
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

// — [v4.2] snapshot cadence per mode (duel every round / raid odd+final / boss every 3rd) —
{
  // atk 0 both sides → no early kill; runs well past round 6 (sudden death starts round 30).
  const inLoop = (sim) => new Set(sim.snapshots.filter((s) => !s.tag).map((s) => s.round));
  const duel = inLoop(resolveBattle(player({ atk: 0, hp: 5000 }), player({ name: 'R', atk: 0, hp: 5000 }), { mode: 'duel', seed: 5 }));
  check('snapshot duel: every round (1,2,3 present)', duel.has(1) && duel.has(2) && duel.has(3), [...duel].join(','));
  const raid = inLoop(resolveBattle(player({ atk: 0, hp: 5000 }), mob({ atk: 0, hp: 5000 }), { mode: 'raid', seed: 5 }));
  check('snapshot raid: odd rounds only (1,3 present; 2,4 absent)', raid.has(1) && raid.has(3) && !raid.has(2) && !raid.has(4), [...raid].join(','));
  const boss = inLoop(resolveBattle(player({ atk: 0, hp: 5000 }), mob({ atk: 0, hp: 5000, mobType: 'boss' }), { mode: 'boss', seed: 5 }));
  check('snapshot boss: every 3rd (3,6 present; 1,2,4 absent)', boss.has(3) && boss.has(6) && !boss.has(1) && !boss.has(2) && !boss.has(4), [...boss].join(','));
}

// — R2: Fighter class stun 1/2 turns, refresh-don't-extend —
{
  const mkF = () => player({ class: 'Fighter', classPassive: 'stun' });
  // 2-turn stun on the 10% band (r < 0.10): skips rounds 1+2, mob first acts round 3
  const s2 = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.05, 0.5, /* r2 */ 0.99, 0.99, 0.5, /* r3 */ 0.99, 0.99, 0.5, 0.99, 0.5]) });
  check('R2: 2-turn stun — mob skips r1', hasEvent(roundEvents(s2, 1), 'unable to act'));
  check('R2: 2-turn stun — mob skips r2', hasEvent(roundEvents(s2, 2), 'unable to act'));
  check('R2: mob acts round 3', hasEvent(roundEvents(s2, 3), 'strikes'));
  // re-proc a 2-turn stun in r2 → refresh to max(1,2)=2 → skips r1–r3, acts r4
  // (extend semantics would stack to 3 remaining and delay to round 5)
  const sR = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.05, 0.5, /* r2 */ 0.99, 0.05, 0.5, /* r3 */ 0.99, 0.99, 0.5, /* r4 */ 0.99, 0.99, 0.5, 0.99, 0.5]) });
  check('R2 refresh: skips r3', hasEvent(roundEvents(sR, 3), 'unable to act'));
  check('R2 refresh-not-extend: acts r4', hasEvent(roundEvents(sR, 4), 'strikes'));
  // 1-turn band (0.10 ≤ r < 0.35)
  const s1 = resolveBattle(mkF(), mob({ hp: 100000 }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.20, 0.5, /* r2 */ 0.99, 0.99, 0.5, 0.99, 0.5]) });
  check('R2: 1-turn stun — skips r1 only', hasEvent(roundEvents(s1, 1), 'unable to act') && hasEvent(roundEvents(s1, 2), 'strikes'));
  // stun-immune boss: no stun, mob acts round 1
  const sImm = resolveBattle(mkF(), mob({ hp: 100000, immunityTags: ['stun'] }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.05, 0.5, 0.99, 0.5]) });
  check('R2: stun negated vs stun-immune', hasEvent(roundEvents(sImm, 1), 'strikes'));
}

// — R8: def_down sources combine highest-wins —
{
  // laevateinn stack (30% by r3) + zeus def_down (20% on r3) → 30% applies, not 50%/multiplicative
  const mk = () => player({ weaponPassiveKey: 'laevateinn_sword', deityBlessingKey: 'zeus_thunder_sovereign' });
  const script = [0.0,
    /* r1 */ 0.99, 0.5, 0.99, 0.5,
    /* r2 */ 0.99, 0.5, 0.99, 0.5,
    /* r3 */ 0.99, 0.5];
  const sim = resolveBattle(mk(), mob({ hp: 50000, def: 200 }), { seed: 1, rng: scripted(script) });
  const r3 = dmgOf(roundEvents(sim, 3), 'attacks');
  // [bonus-fix] zeus +80% now rides the mitigated ATK lane: effATK 300×1.80=540.
  // shred 0.30 → DEF 140 → 540×(200/340)=317.6 → 317 (highest-wins).
  check('R8: highest-wins r3 damage = 317', r3 === 317, `got ${r3}`);
  // multiplicative def_down (0.30,0.20→0.44) would give DEF 112 → 540×(200/312)=346.
  check('R8: not multiplicative (≠346)', r3 !== 346);
}

// — def_down immunity blocks ALL sources including the laevateinn stack —
{
  const mk = () => player({ weaponPassiveKey: 'laevateinn_sword', deityBlessingKey: 'zeus_thunder_sovereign' });
  const sim = resolveBattle(mk(), mob({ hp: 50000, def: 200, immunityTags: ['def_down'] }),
    { seed: 1, rng: scripted([0.0, 0.99, 0.5, 0.99, 0.5, 0.99, 0.5, 0.99, 0.5, 0.99, 0.5]) });
  check('def_down-immune: no Sundering Flame stacks', !hasEvent(allEvents(sim), 'Sundering Flame'));
  const r3 = dmgOf(roundEvents(sim, 3), 'attacks');
  // [bonus-fix] DEF 200 unshredded, zeus +80% mitigated: effATK 540 → 540×(200/400)=270
  check('def_down-immune r3 damage = 270', r3 === 270, `got ${r3}`);
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
  const sDuel = resolveBattle(mkK(), player({ name: 'Rival', hp: 100000 }),
    { mode: 'duel', seed: 1, rng: scripted([0.0, 0.99, 0.99, 0.01, 0.5, 0.5]) });
  check('instakill disabled in duels', sDuel.outcome !== 'instakill');
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
  const b = applyCombatExp(1, 0, 650);
  check('exp: multi-level 1→4 (100+200+350)', b.level === 4 && b.exp === 0, JSON.stringify(b));
  const c = applyCombatExp(1, 50, 100);
  check('exp: within-level carry (50+100 → L2, 50 over)', c.level === 2 && c.exp === 50, JSON.stringify(c));
  const d = applyCombatExp(10, 0, 3999);
  check('exp: no level below threshold (10→11 needs 4000)', d.level === 10 && d.exp === 3999 && !d.leveledUp, JSON.stringify(d));
  const e = applyCombatExp(49, 0, 5000000);
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
  const md = fs.readFileSync(path.join(ROOT, 'passive_registry_keys.md'), 'utf8');
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
      bonusDmgPct: fx() < 0.2 ? 50 : 0, bonusCritDmgPct: fx() < 0.2 ? 50 : 0,
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

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`SELFTEST: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('All checks passed.');
