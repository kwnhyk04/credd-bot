'use strict';

/**
 * alignSkins.js — per-skin canvas-config pixel-alignment loop
 * (docs/claude_code_skin_pixel_alignment_prompt.md).
 *
 *   node scripts/alignSkins.js
 *
 * For EVERY renderable skin this:
 *   1. resolves the skin art + its colocated `<basename>.layout.json` (cloning the
 *      category-default template + logging a warning if the skin has none yet),
 *   2. renders realistic worst-case sample data onto the art at the locked size
 *      (1536x1024) through the generic layout renderer — zero hardcoded coords,
 *   3. measures the gap against the skin's reference image
 *      (assets/skins/_reference/<skin_key>.png),
 *   4. auto-corrects the config by the measured offset and re-renders,
 *   5. loops until aligned (<= +/-2 px) or 25 iterations, and
 *   6. saves tmp/align/<skin_key>/iterN.png + diff.png artifacts.
 *
 * Reference handling (spec): when a skin has NO reference image we cannot converge
 * on nothing, so we render a first pass, save it to proposed_reference.png, and flag
 * it PENDING_REF for human approval instead of blindly looping.
 *
 * Measurement: when a reference exists we derive each frame's "content mask" (pixels
 * that differ from the bare art) for both the render and the reference, then nudge the
 * whole layout by the centroid offset between the two masks. This is the automated
 * global-block correction; tightening individual elements to +/-2 px each needs a
 * reference carrying per-element metadata, which is noted in the residual report.
 *
 * Only profile skins are layout-rendered today; battle / battle_result have no text
 * compositor yet (deferred) and are reported as SKIP(no-renderer) rather than faked.
 *
 * Touches code + config (layout.json) + tmp artifacts only. No DB, no schema.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { LOCKED, SKINS_DIR, DIRS, SET_FILES } = require('../src/config/cosmetics');
const {
  renderProfileLayoutImage, layoutPathFor,
} = require('../src/engine/profileLayoutRenderer');

const ROOT = path.join(__dirname, '..');
const REF_DIR = path.join(SKINS_DIR, '_reference');
const OUT_DIR = path.join(ROOT, 'tmp', 'align');
const MAX_ITERS = 25;
const TOLERANCE = 2;       // px, per acceptance tolerance
const DIFF_THRESHOLD = 28; // per-channel delta that counts a pixel as "content"

// Canonical clone-template for a profile skin that ships without its own config.
const PROFILE_TEMPLATE = path.join(SKINS_DIR, 'supporters', 'base', 'profile.layout.json');

// Worst-case sample data: a long name, the dev top-label, max-width stats + full record.
const SAMPLE = {
  displayName: 'Maximiliana the Everlasting Flame',
  topLabel: { hasTopLabel: true, word: 'Founder 000' },
  believerLevel: 87, believerExp: 124500, believerExpMax: 150000,
  believerTitle: 'Keeper of the Eternal Vow',
  className: 'Mystic', combatLevel: 60, combatExp: 980000, combatExpMax: null,
  weaponName: 'Worldbreaker Greatsword', weaponEnh: 12,
  deityName: 'Bathala, the All-Father', deityEnh: 9, blessingName: 'Divine Vessel',
  atk: 99999, hp: 88888, def: 77777, crit: 73.5,
  records: {
    raids: 1284, raidsWon: 1190, raidStreak: 47,
    duels: 932, duelWins: 870, duelStreak: 38,
  },
  quote: 'The last believer never kneels.',
  avatarUrl: null, fallbackAvatarUrl: null,
};

const results = []; // { key, status, iters, residual, notes }

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

/** Decode an image buffer/path to a 1536x1024 RGBA pixel buffer (normalized). */
async function toPixels(source) {
  const img = await loadImage(source);
  const canvas = createCanvas(LOCKED.w, LOCKED.h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, LOCKED.w, LOCKED.h);
  return ctx.getImageData(0, 0, LOCKED.w, LOCKED.h).data;
}

/** Centroid (x,y) of pixels in `frame` that differ from `bare` past the threshold. */
function contentCentroid(frame, bare) {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0, p = 0; i < frame.length; i += 4, p++) {
    const dr = Math.abs(frame[i] - bare[i]);
    const dg = Math.abs(frame[i + 1] - bare[i + 1]);
    const db = Math.abs(frame[i + 2] - bare[i + 2]);
    if (dr > DIFF_THRESHOLD || dg > DIFF_THRESHOLD || db > DIFF_THRESHOLD) {
      sx += p % LOCKED.w;
      sy += (p / LOCKED.w) | 0;
      n++;
    }
  }
  if (!n) return null;
  return { x: sx / n, y: sy / n, n };
}

/** Heatmap of |render - reference| (amplified) for human review. */
function diffHeatmap(a, b) {
  const canvas = createCanvas(LOCKED.w, LOCKED.h);
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(LOCKED.w, LOCKED.h);
  let maxDelta = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    const v = Math.min(255, d);
    if (v > maxDelta) maxDelta = v;
    out.data[i] = v;            // red channel = magnitude
    out.data[i + 1] = v > 40 ? 40 : 0;
    out.data[i + 2] = 0;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return { buf: canvas.toBuffer('image/png'), maxDelta };
}

/** Shift every positioned element in a profile layout by (dx, dy), rounded. */
function nudgeLayout(layout, dx, dy) {
  const idx = Math.round(dx), idy = Math.round(dy);
  const bump = (o) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.x === 'number') o.x += idx;
    if (typeof o.y === 'number') o.y += idy;
    if (Array.isArray(o.cols)) for (const c of o.cols) { if (typeof c.x === 'number') c.x += idx; }
  };
  for (const v of Object.values(layout)) {
    if (Array.isArray(v)) v.forEach(bump);
    else bump(v);
  }
  return { idx, idy };
}

/** Render a profile skin to a PNG buffer using its layout. */
async function renderProfile(skinPath, layoutPath) {
  return renderProfileLayoutImage(SAMPLE, { skinPath, layoutPath });
}

async function alignProfile(key, skinPath) {
  const notes = [];
  const dir = path.join(OUT_DIR, key);
  ensureDir(dir);

  // Resolve / bootstrap the per-skin config.
  const layoutPath = layoutPathFor(skinPath);
  if (!fs.existsSync(layoutPath)) {
    writeJson(layoutPath, readJson(PROFILE_TEMPLATE));
    notes.push('cloned category-default config (skin shipped without one)');
    console.warn(`[alignSkins] WARN ${key}: no config — cloned template to ${path.relative(ROOT, layoutPath)}`);
  }

  // Bare art (no content) as the differencing baseline.
  let bare;
  try { bare = await toPixels(skinPath); } catch (err) {
    results.push({ key, status: 'FAIL', iters: 0, residual: null, notes: [err.message] });
    return;
  }

  const refPath = path.join(REF_DIR, `${key}.png`);
  const haveRef = fs.existsSync(refPath);

  // First render.
  let buf = await renderProfile(skinPath, layoutPath);
  fs.writeFileSync(path.join(dir, 'iter0.png'), buf);

  if (!haveRef) {
    // Cannot converge on nothing — propose this render as the reference for approval.
    fs.writeFileSync(path.join(dir, 'proposed_reference.png'), buf);
    results.push({
      key, status: 'PENDING_REF', iters: 0, residual: null,
      notes: [...notes, `no reference — proposed_reference.png awaiting approval at ${path.relative(ROOT, refPath)}`],
    });
    return;
  }

  const refPx = await toPixels(refPath);
  const refC = contentCentroid(refPx, bare);

  let iters = 0;
  let residual = Infinity;
  let last = buf;
  while (iters < MAX_ITERS) {
    const px = await toPixels(last);
    const c = contentCentroid(px, bare);
    if (!c || !refC) { notes.push('empty content mask — cannot measure'); break; }
    const dx = refC.x - c.x;
    const dy = refC.y - c.y;
    residual = Math.max(Math.abs(dx), Math.abs(dy));
    if (residual <= TOLERANCE) break;

    const layout = readJson(layoutPath);
    const { idx, idy } = nudgeLayout(layout, dx, dy);
    if (idx === 0 && idy === 0) break; // sub-pixel — nothing more to gain
    writeJson(layoutPath, layout);

    iters++;
    last = await renderProfile(skinPath, layoutPath);
    fs.writeFileSync(path.join(dir, `iter${iters}.png`), last);
  }

  // Final diff heatmap.
  const finalPx = await toPixels(last);
  const { buf: heat } = diffHeatmap(finalPx, refPx);
  fs.writeFileSync(path.join(dir, 'diff.png'), heat);

  results.push({
    key,
    status: residual <= TOLERANCE ? 'PASS' : 'RESIDUAL',
    iters,
    residual: Number.isFinite(residual) ? Math.round(residual * 10) / 10 : null,
    notes,
  });
}

// ── Enumerate every profile skin across base / store / testers / founder ─────
function profileSkins() {
  const list = []; // { key, skinPath }
  const add = (key, rel) => {
    const abs = path.join(SKINS_DIR, ...rel.split('/'));
    if (fs.existsSync(abs)) list.push({ key, skinPath: abs });
  };

  // Base set.
  add('base_profile', `${DIRS.base}/profile.png`);

  // Store profile catalog art (parsed from disk so the script needs no DB).
  const storeProfile = path.join(SKINS_DIR, ...DIRS.storeProfile.split('/'));
  if (fs.existsSync(storeProfile)) {
    for (const f of fs.readdirSync(storeProfile)) {
      if (f.endsWith('.png')) add(`store_${path.basename(f, '.png')}`, `${DIRS.storeProfile}/${f}`);
    }
  }

  // Founder set.
  for (const cand of SET_FILES.profile) add('founder_profile', `${DIRS.founder}/${cand}`);

  // Testers default set (the beta base owned by everyone) + per-user folders.
  for (const cand of SET_FILES.profile) add('testers_default', `${DIRS.testers}/${cand}`);
  const testersAbs = path.join(SKINS_DIR, ...DIRS.testers.split('/'));
  if (fs.existsSync(testersAbs)) {
    for (const ent of fs.readdirSync(testersAbs, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      for (const cand of SET_FILES.profile) add(`testers_${ent.name}`, `${DIRS.testers}/${ent.name}/${cand}`);
    }
  }

  // De-dup by key (SET_FILES probes multiple basenames; first hit wins).
  const seen = new Set();
  return list.filter((s) => (seen.has(s.key) ? false : seen.add(s.key)));
}

async function main() {
  ensureDir(OUT_DIR);
  if (!fs.existsSync(REF_DIR)) {
    fs.mkdirSync(REF_DIR, { recursive: true });
    console.warn(`[alignSkins] created ${path.relative(ROOT, REF_DIR)} — drop approved <skin_key>.png references here.`);
  }

  for (const { key, skinPath } of profileSkins()) {
    try { await alignProfile(key, skinPath); }
    catch (err) { results.push({ key, status: 'FAIL', iters: 0, residual: null, notes: [err.message] }); }
  }

  // Summary table.
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n[alignSkins] ${results.length} profile skins → ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`  ${pad('SKIN', 26)} ${pad('STATUS', 12)} ${pad('ITERS', 6)} ${pad('RESID', 7)} NOTES`);
  for (const r of results) {
    console.log(`  ${pad(r.key, 26)} ${pad(r.status, 12)} ${pad(r.iters, 6)} ${pad(r.residual ?? '-', 7)} ${r.notes.join('; ')}`);
  }
  const pass = results.filter((r) => r.status === 'PASS').length;
  const pending = results.filter((r) => r.status === 'PENDING_REF').length;
  const resid = results.filter((r) => r.status === 'RESIDUAL').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n  PASS ${pass} · PENDING_REF ${pending} · RESIDUAL ${resid} · FAIL ${fail}`);
  console.log('  (battle / battle_result: SKIP — no text compositor yet, alignment deferred)');
  if (fail) process.exitCode = 1;
}

main();
