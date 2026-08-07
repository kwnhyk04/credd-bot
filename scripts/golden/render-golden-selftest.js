'use strict';

/**
 * C2 — GOLDEN RENDER CHARACTERIZATION HARNESS (Phase 0, refactor plan).
 *
 * Renders five canvas surfaces from fixed synthetic fixtures and SHA-256 hashes
 * the PNG bytes: boss status card, one battle frame, stats card, profile card,
 * quest rows. Baselines: scripts/golden/render-hashes.json (+ the PNGs
 * themselves under scripts/golden/renders/ for human diffing).
 *
 * MACHINE-LOCAL BASELINES: canvas/font output varies by platform and library
 * build. Regenerate baselines on the machine that verifies. See README.md in
 * this directory — regeneration requires a manual visual diff of the PNGs,
 * never hash-only acceptance.
 *
 * Runs offline: attachments allowed, remote assets disabled, no DB required
 * (canvas cache is bypassed via its returnImageOnFailure fallback).
 *
 * Usage:
 *   node scripts/golden/render-golden-selftest.js           # verify
 *   node scripts/golden/render-golden-selftest.js --write   # (re)write baseline
 */

process.env.ALLOW_DISCORD_IMAGE_ATTACHMENTS = 'true';
process.env.ASSET_BASE_URL = '';
process.env.RESOURCE_LOGS = 'false';
process.env.PERFORMANCE_LOGS = 'false';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const RENDER_DIR = path.join(__dirname, 'renders');
const BASELINE_PATH = path.join(__dirname, 'render-hashes.json');

const { resolveBattle } = require(path.join(ROOT, 'src', 'engine', 'battleEngine'));
const { renderBattlePanel } = require(path.join(ROOT, 'src', 'engine', 'battleRender'));
const { renderStatsImage } = require(path.join(ROOT, 'src', 'engine', 'renderStats'));
const { renderProfileImage } = require(path.join(ROOT, 'src', 'engine', 'renderProfile'));
const { renderQuestRowsImage } = require(path.join(ROOT, 'src', 'engine', 'renderQuestRows'));
const bossSystem = require(path.join(ROOT, 'src', 'engine', 'bossSystem'));

// ── fixtures ────────────────────────────────────────────────────────────────

function goldenSim() {
  return resolveBattle(
    {
      name: 'Golden Hero', kind: 'player', class: 'Knight', classPassive: 'damage_reduction',
      level: 50, atk: 300, hp: 2000, def: 150, crit: 20, bonusDmgPct: 0,
      weaponPassiveKey: 'none', weaponName: 'Test Blade',
      deityBlessingKey: 'none', deityName: null,
    },
    {
      name: 'Golden Dummy', kind: 'mob', mobType: 'regular', level: 10,
      atk: 100, hp: 3000, def: 80, crit: 0,
      skillKey: 'none', immunityTags: [], specialFlags: {},
    },
    { mode: 'raid', seed: 424242 },
  );
}

function characterFixture() {
  return {
    displayName: 'Golden Tester',
    discordId: '100000000000000001',
    believerLevel: 12,
    believerTitle: 'Believer',
    equippedTitle: null,
    believerExp: 350,
    believerExpMax: 1000,
    className: 'Knight',
    combatLevel: 42,
    combatExp: 12345,
    combatExpMax: 20000,
    weaponName: 'Test Blade',
    weaponEnh: 3,
    armorName: 'Test Plate',
    armorType: 'heavy',
    armorEnh: 2,
    deityName: 'Zeus',
    deity2Name: null,
    deity3Name: null,
    deityEnh: 1,
    blessingName: 'None',
    echoBlessing: null,
    atk: 512, hp: 4096, def: 256, crit: 25,
    records: {
      raids: 100, raidWins: 90, duels: 20, duelWins: 10,
      bossKills: 5, highestRaidStreak: 12,
    },
    skinPath: null,           // default template path — no cosmetic dependency
    topLabel: null,
    avatarPath: null,
    avatarFallbackPath: null, // renderer falls back internally
    avatarAssetAvailable: null,
    supporterBadgePath: null,
    supporterBadgeAssetAvailable: null,
  };
}

function questsFixture() {
  // Field names per src/engine/renderQuestRows.js: name/completed/current/target
  // + rewardCredux/rewardShards/rewardValor/rewardRelics.
  return [
    { type: 'raid', name: 'Win 5 raids', current: 3, target: 5, rewardCredux: 100, rewardShards: 2, rewardRelics: 0, completed: false },
    { type: 'duel', name: 'Win 2 duels', current: 2, target: 2, rewardCredux: 150, rewardShards: 3, rewardRelics: 1, completed: true },
    { type: 'bestow', name: 'Bestow 500 credux', current: 0, target: 500, rewardCredux: 50, rewardShards: 1, rewardRelics: 0, completed: false },
  ];
}

function bossViewFixture() {
  return {
    state: {
      guild_id: '200000000000000001',
      spawn_id: 'golden-spawn-0001',
      mob_id: 1,
      max_hp: '50000',
      current_hp: '32500',
      scaled_atk: '450',
      scaled_def: '220',
      spawn_at: new Date('2026-08-07T00:00:00Z'),
      expires_at: new Date('2026-08-08T00:00:00Z'),
      status: 'active',
      spawn_source: 'schedule',
      last_attack_at: null,
      passive_state: {},
    },
    mobRow: {
      mob_id: 1,
      name: 'Golden Boss',
      mythology: 'greek',
      base_hp: 10000, hp_per_level: 500,
      base_atk: 100, atk_per_level: 10,
      base_def: 50, def_per_level: 5,
      base_crit: 5,
      skill_name: 'Golden Skill',
      skill_description: 'A fixed synthetic passive description for characterization.',
    },
    attackers: [
      { discord_id: '100000000000000001', total_damage: '9000' },
      { discord_id: '100000000000000002', total_damage: '4500' },
    ],
    attackerCount: 2,
    isDev: false,
  };
}

// ── cases ───────────────────────────────────────────────────────────────────

async function bossStatusCardPng() {
  // renderBossStatusCard is not exported; the exported buildBossMessage path
  // reaches it through bossStatusImage. With no DB the canvas cache falls back
  // (returnImageOnFailure) and with attachments allowed the PNG comes back as
  // an attachment buffer. includeBanner:false keeps the case to the status card.
  const view = bossViewFixture();
  const payload = await bossSystem.buildBossMessage(view, {
    includeStatusImage: true,
    includeBanner: false,
    phase: 'golden',
  });
  const files = payload?.files || [];
  const withBuffer = files.find((f) => Buffer.isBuffer(f?.attachment));
  if (!withBuffer) throw new Error(`boss status attachment not found (files=${files.length})`);
  return withBuffer.attachment;
}

async function battleFramePng() {
  const sim = goldenSim();
  const buf = await renderBattlePanel(sim, 0, { mirror: false, icons: null });
  if (!Buffer.isBuffer(buf)) throw new Error('renderBattlePanel did not return a Buffer');
  return buf;
}

const CASES = {
  'boss-status-card': bossStatusCardPng,
  'battle-frame': battleFramePng,
  'stats-card': () => renderStatsImage(characterFixture()),
  'profile-card': () => renderProfileImage(characterFixture()),
  'quest-rows': () => renderQuestRowsImage(questsFixture()),
};

async function runAll() {
  const out = {};
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  for (const [id, fn] of Object.entries(CASES)) {
    const buf = await fn();
    if (!Buffer.isBuffer(buf)) throw new Error(`${id}: renderer returned ${typeof buf}, expected Buffer`);
    out[id] = { hash: crypto.createHash('sha256').update(buf).digest('hex'), buf };
  }
  return out;
}

async function main() {
  const write = process.argv.includes('--write');
  const results = await runAll();
  if (write) {
    const baseline = {};
    for (const [id, { hash, buf }] of Object.entries(results)) {
      baseline[id] = hash;
      fs.writeFileSync(path.join(RENDER_DIR, `${id}.png`), buf);
    }
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`[C2] baseline written: ${Object.keys(baseline).length} renders -> ${path.relative(ROOT, BASELINE_PATH)}`);
    console.log('[C2] REMINDER: visually inspect the PNGs under scripts/golden/renders/ before committing.');
    return;
  }
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error('[C2] FAIL: baseline missing. Run with --write first (on known-good code only).');
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const mismatches = [];
  for (const [id, expected] of Object.entries(baseline)) {
    const got = results[id]?.hash;
    if (got !== expected) mismatches.push(`${id}: ${String(got).slice(0, 12)} != ${expected.slice(0, 12)}`);
  }
  if (Object.keys(results).length !== Object.keys(baseline).length) {
    mismatches.push(`case count ${Object.keys(results).length} != baseline ${Object.keys(baseline).length}`);
  }
  if (mismatches.length > 0) {
    console.error(`[C2] FAIL: ${mismatches.length} mismatch(es):`);
    for (const m of mismatches) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log(`[C2] OK: ${Object.keys(baseline).length} renders byte-identical to baseline.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[C2] FAIL:', err);
  process.exit(1);
});
