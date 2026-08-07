'use strict';

/**
 * C1 — GOLDEN BATTLE CHARACTERIZATION HARNESS (Phase 0, refactor plan).
 *
 * Locks resolveBattle output across code versions: a fixed fixture stream
 * (rngOf(GOLDEN_FIXTURE_SEED)) builds deterministic fighters, then each case runs
 * resolveBattle with a fixed battle seed and the full sim JSON is SHA-256 hashed.
 * Hashes live in scripts/golden/battle-hashes.json.
 *
 * Sandbox-safe: NO database, NO Discord, NO env required (same contract as
 * scripts/battle-selftest.js).
 *
 * Usage:
 *   node scripts/golden/battle-golden-selftest.js           # verify against baseline
 *   node scripts/golden/battle-golden-selftest.js --write   # (re)write baseline
 *
 * Baseline regeneration is ONLY legitimate when behavior is INTENTIONALLY changed;
 * during the behavior-preserving refactor any hash diff means REVERT THE STEP.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const { resolveBattle, rngOf } = require(path.join(ROOT, 'src', 'engine', 'battleEngine'));

const BASELINE_PATH = path.join(__dirname, 'battle-hashes.json');
const GOLDEN_FIXTURE_SEED = 20260807; // frozen — changing it invalidates every baseline
const SEEDS_PER_MODE = 50;
const MODES = ['raid', 'duel', 'boss'];

// ── fixtures (same shapes as scripts/battle-selftest.js) ────────────────────
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

// Passive keys come from the authoritative ledger, exactly like the fuzz section
// of battle-selftest.js, so the case set exercises real registry keys.
function ledgerKeys() {
  const md = fs.readFileSync(path.join(ROOT, 'assets', 'data', 'passive_registry_keys.md'), 'utf8');
  const grab = (header, stop) => {
    const seg = md.slice(md.indexOf(header), stop ? md.indexOf(stop) : undefined);
    return [...seg.matchAll(/^- `([a-z0-9_]+)`/gm)].map((m) => m[1]);
  };
  return {
    weaponKeys: grab('## WEAPON', '## DEITY'),
    deityKeys: grab('## DEITY', '## MOB'),
    mobKeys: grab('## MOB'),
  };
}

const CLASSES = [
  ['Swordsman', 'bleed'], ['Fighter', 'stun'], ['Mage', 'overcharge'],
  ['Knight', 'damage_reduction'], ['Archer', 'pierce'],
];

function buildCases() {
  const { weaponKeys, deityKeys, mobKeys } = ledgerKeys();
  const fx = rngOf(GOLDEN_FIXTURE_SEED); // fixture stream, independent of battle seeds
  const pick = (arr) => arr[Math.floor(fx() * arr.length)];
  const cases = [];
  for (const mode of MODES) {
    for (let i = 0; i < SEEDS_PER_MODE; i++) {
      const [cls, cp] = pick(CLASSES);
      const a = player({
        class: cls, classPassive: cp,
        atk: 50 + Math.floor(fx() * 800), hp: 200 + Math.floor(fx() * 6000),
        def: Math.floor(fx() * 400), crit: Math.floor(fx() * 46),
        bonusDmgPct: fx() < 0.2 ? 50 : 0,
        weaponPassiveKey: pick(weaponKeys), deityBlessingKey: pick(deityKeys),
      });
      let b;
      if (mode === 'duel') {
        const [cls2, cp2] = pick(CLASSES);
        b = player({
          name: 'Rival', class: cls2, classPassive: cp2,
          atk: 50 + Math.floor(fx() * 800), hp: 200 + Math.floor(fx() * 6000),
          def: Math.floor(fx() * 400), crit: Math.floor(fx() * 46),
          weaponPassiveKey: pick(weaponKeys), deityBlessingKey: pick(deityKeys),
        });
      } else if (mode === 'boss') {
        const poolMaxHp = 20000 + Math.floor(fx() * 80000);
        b = mob({
          name: 'Golden Boss', mobType: 'boss', level: 40 + Math.floor(fx() * 30),
          atk: 200 + Math.floor(fx() * 600), hp: poolMaxHp,
          def: 100 + Math.floor(fx() * 300), crit: Math.floor(fx() * 20),
          skillKey: pick(mobKeys),
          poolMaxHp, poolHp: Math.max(1, Math.floor(poolMaxHp * fx())),
        });
      } else {
        b = mob({
          atk: 60 + Math.floor(fx() * 300), hp: 500 + Math.floor(fx() * 8000),
          def: Math.floor(fx() * 250), crit: Math.floor(fx() * 15),
          skillKey: fx() < 0.5 ? pick(mobKeys) : 'none',
        });
      }
      const battleSeed = (1000 + cases.length * 7919) >>> 0; // fixed, derived, collision-free
      cases.push({ id: `${mode}-${String(i).padStart(2, '0')}-seed${battleSeed}`, mode, a, b, battleSeed });
    }
  }
  return cases;
}

function runAll() {
  const out = {};
  for (const c of buildCases()) {
    const sim = resolveBattle(c.a, c.b, { mode: c.mode, seed: c.battleSeed });
    out[c.id] = crypto.createHash('sha256').update(JSON.stringify(sim)).digest('hex');
  }
  return out;
}

function main() {
  const write = process.argv.includes('--write');
  const actual = runAll();
  const caseCount = Object.keys(actual).length;
  if (write) {
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`[C1] baseline written: ${caseCount} cases -> ${path.relative(ROOT, BASELINE_PATH)}`);
    return;
  }
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error('[C1] FAIL: baseline missing. Run with --write first (on known-good code only).');
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const baseIds = Object.keys(baseline);
  const mismatches = [];
  if (baseIds.length !== caseCount) mismatches.push(`case count ${caseCount} != baseline ${baseIds.length}`);
  for (const id of baseIds) {
    if (actual[id] !== baseline[id]) mismatches.push(`${id}: ${String(actual[id]).slice(0, 12)} != ${String(baseline[id]).slice(0, 12)}`);
  }
  if (mismatches.length > 0) {
    console.error(`[C1] FAIL: ${mismatches.length} mismatch(es):`);
    for (const m of mismatches.slice(0, 20)) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log(`[C1] OK: ${caseCount} battle sims byte-identical to baseline.`);
}

main();
