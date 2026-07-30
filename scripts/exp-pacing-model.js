'use strict';

/**
 * exp-pacing-model.js — how long the v2 curve actually takes to climb.
 *
 *   npm run model:exp-pacing
 *
 * Read-only analysis. No DB, no writes, no assertions — this is a thinking tool, not a
 * test, which is why it is deliberately NOT part of selftest:full.
 *
 * It imports scaleExpForMobLevel and the curve from the live modules rather than
 * restating them, so a divergence between this model and shipped behaviour is not
 * expressible. That matters: an earlier revision of this analysis hardcoded its own
 * reward assumptions and was wrong by 48x (see ASSUMPTIONS below).
 */

const {
  MAX_COMBAT_LEVEL,
  EXP_TO_NEXT,
  CUMULATIVE_EXP,
} = require('../src/config/combatExp');
const {
  scaleExpForMobLevel,
  MOB_LEVEL_OFFSET_MIN,
  MOB_LEVEL_OFFSET_MAX,
} = require('../src/config/expScaling');
const { RAID_LOOT, ELITE_SPAWN_CHANCE } = require('../src/config/raidLoot');
const { MAX_BOSS_ATTACKS_PER_DAY } = require('../src/config/bosses');

// ── ASSUMPTIONS ─────────────────────────────────────────────────────────────
// Every number below is an assumption, stated so it can be argued with.
//
// DAILY ENGAGEMENT: 300,000 EXP/day for a top-decile player, an owner observation
// from before v2 (when all rewards were flat). It is not a guess — it back-tests:
// under the OLD curve at 300,000/day, level 31 arrives at 25.5 days, against the
// observed "level 31 in under a month". Every timing here scales inversely with this
// number, so it is the single most load-bearing input. If real throughput is
// 450,000/day, divide the years by 1.5.
//
// COMPOSITION: 300,000/day decomposes as auto-raid 216,000 (72%) + 2 capped bosses
// 47,500 (15.8%) + ~122 manual raids 36,500 (12.2%, about 30 minutes at the 15s
// cooldown). The model scales each component on its own basis rather than scaling the
// 300,000 wholesale, because auto-raid and manual raids scale on MOB level while
// bosses scale on the PARTICIPANT's level.
//
// THE BOSS CAP IS REAL AND ENFORCED. MAX_BOSS_ATTACKS_PER_DAY is imported, not assumed.
// A previous version of this model swept 12/48/96 bosses per day and concluded bosses
// were a power-leveling route that needed a damper. All of those archetypes are
// impossible — Gate 4 in bossSystem.js caps attacks at 2/day — and the sweep overstated
// boss throughput 48x. The lesson worth keeping: reading what a reward PAYS from source
// while assuming how OFTEN you can collect it produces a model that looks
// source-derived and is fiction.
const DAILY_EXP_RATE = 300_000;
const AUTORAID_EXP_PER_DAY_BASE = 216_000;   // 9,000/hr x 24h, level-invariant pre-scaling
const MANUAL_RAIDS_PER_DAY = 122;
const BOSSES_PER_DAY = MAX_BOSS_ATTACKS_PER_DAY;

const avg = ([lo, hi]) => (lo + hi) / 2;

// Blended EXP per raid win at the live spawn split.
const EXP_PER_RAID = (1 - ELITE_SPAWN_CHANCE) * avg(RAID_LOOT.regular.win.exp)
  + ELITE_SPAWN_CHANCE * avg(RAID_LOOT.elite.win.exp);

// Blended boss participation EXP: 70% normal, 30% greater (of which 25% golden).
const EXP_PER_BOSS = 0.7 * 20_000 + 0.3 * (0.75 * 30_000 + 0.25 * 40_000);

/**
 * Expected scaling multiplier for a RAID at `playerLevel`, over the real rollMobLevel
 * distribution. Uses E[multiplier], not multiplier(E[level]) — the multiplier is
 * quadratic, so those differ (Jensen's gap: 2.0% at level 30, 0.2% at level 100).
 * Small, but free to compute correctly.
 */
function expectedRaidMultiplier(playerLevel) {
  let total = 0;
  let count = 0;
  for (let offset = MOB_LEVEL_OFFSET_MIN; offset <= MOB_LEVEL_OFFSET_MAX; offset += 1) {
    total += scaleExpForMobLevel(1000, playerLevel + offset) / 1000;
    count += 1;
  }
  return total / count;
}

/** Boss EXP scales on the participant's OWN level, so no distribution is involved. */
function bossMultiplier(playerLevel) {
  return scaleExpForMobLevel(1000, playerLevel) / 1000;
}

function ratePerDay(playerLevel, { autoraid = true, manual = true, bosses = BOSSES_PER_DAY } = {}) {
  const raidMult = expectedRaidMultiplier(playerLevel);
  let rate = 0;
  if (autoraid) rate += AUTORAID_EXP_PER_DAY_BASE * raidMult;
  if (manual) rate += MANUAL_RAIDS_PER_DAY * EXP_PER_RAID * raidMult;
  if (bosses > 0) rate += bosses * EXP_PER_BOSS * bossMultiplier(playerLevel);
  return rate;
}

function yearsToReach(targetLevel, options) {
  let days = 0;
  for (let level = 1; level < targetLevel; level += 1) {
    days += EXP_TO_NEXT[level - 1] / ratePerDay(level, options);
  }
  return days / 365;
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

console.log('\n=== EXP PACING MODEL (Progression v2) ===');
console.log(`Curve: cap ${MAX_COMBAT_LEVEL}, ${fmt(CUMULATIVE_EXP[MAX_COMBAT_LEVEL - 1])} total EXP to the cap`);
console.log(`Assumed engagement: ${fmt(DAILY_EXP_RATE)} EXP/day pre-scaling (back-tested: L31 in 25.5 days on the OLD curve)`);
console.log(`Boss cap: ${BOSSES_PER_DAY} attacks/day (imported from config/bosses.js — enforced at Gate 4)\n`);

console.log('--- EXP sources, unscaled ---');
console.log(`  raid win (blended ${(1 - ELITE_SPAWN_CHANCE) * 100}/${ELITE_SPAWN_CHANCE * 100}): ${fmt(EXP_PER_RAID)}`);
console.log(`  boss participation (blended): ${fmt(EXP_PER_BOSS)}`);
console.log(`  auto-raid, 24h: ${fmt(AUTORAID_EXP_PER_DAY_BASE)}/day`);

console.log('\n--- scaling multiplier by player level ---');
console.log('  level |  raid E[mult] | boss mult | EXP/raid | EXP/boss');
for (const level of [1, 10, 20, 30, 50, 75, 100]) {
  const rm = expectedRaidMultiplier(level);
  const bm = bossMultiplier(level);
  console.log(
    `  ${String(level).padStart(5)} | ${rm.toFixed(3).padStart(13)} | ${bm.toFixed(3).padStart(9)} `
    + `| ${fmt(EXP_PER_RAID * rm).padStart(8)} | ${fmt(EXP_PER_BOSS * bm).padStart(8)}`
  );
}

console.log('\n--- daily rate and time to reach, by archetype ---');
const archetypes = [
  ['full anchor (auto + 2 bosses + manual)', {}],
  ['auto-raid + 2 bosses', { manual: false }],
  ['auto-raid only', { manual: false, bosses: 0 }],
  ['2 bosses only', { autoraid: false, manual: false }],
];
for (const [name, options] of archetypes) {
  const targets = [30, 40, 50, 60, 75, 100]
    .map((lv) => `L${lv} ${yearsToReach(lv, options).toFixed(2)}y`)
    .join(' | ');
  console.log(`  ${name}`);
  console.log(`    ${targets}`);
  console.log(`    rate at L100: ${fmt(ratePerDay(100, options))} EXP/day`);
}

console.log('\n--- boss share of daily EXP (the cap is what keeps this a minority) ---');
for (const level of [30, 50, 75, 100]) {
  const total = ratePerDay(level);
  const boss = BOSSES_PER_DAY * EXP_PER_BOSS * bossMultiplier(level);
  console.log(`  L${String(level).padStart(3)}: ${((boss / total) * 100).toFixed(1)}%  (${fmt(boss)} of ${fmt(total)} EXP/day)`);
}

console.log('\n--- time per level across the tail (the 1.76x residual inversion) ---');
for (const level of [51, 60, 70, 80, 90, 99]) {
  const days = EXP_TO_NEXT[level - 1] / ratePerDay(level);
  console.log(`  L${level} -> ${level + 1}: ${days.toFixed(1)} days  (cost ${fmt(EXP_TO_NEXT[level - 1])})`);
}
console.log(
  '\n  Days per level DECLINE across the tail. That is a known, accepted tradeoff:\n'
  + '  quadratic scaling outruns the 1,000,000/level gap. Flattening it fully needs\n'
  + '  ~2,100,000/level, which pushes the cap past 9 years.\n'
);
