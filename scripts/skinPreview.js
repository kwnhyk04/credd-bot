'use strict';

/**
 * skinPreview.js — canvas-fit preview harness (Supporter-stage spec §10).
 *
 *   node scripts/skinPreview.js
 *
 * For EVERY skin (base + store catalog rows, founder set, testers default set, and the
 * per-user custom folders) this:
 *   - loads the REAL asset, normalizes it to the locked size (LOCKED.w × LOCKED.h),
 *   - composites realistic sample data (long name, top-label word on profile, a rewards
 *     block on battle_result),
 *   - writes the result to tmp/skin_preview/ for visual review, and
 *   - asserts the sample content fits the frame's content zones (top-label band on
 *     profile, reward band on result), reporting any clip.
 *
 * Do NOT assume fit — this loads the actual files. Summon webps are animated; we render
 * their first frame as a still so the catalog reference can be eyeballed.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const pool = require('../src/db/pool');
const { LOCKED, DIRS, SKINS_DIR, skinFilePath, SET_FILES } = require('../src/config/cosmetics');

const OUT = path.join(__dirname, '..', 'tmp', 'skin_preview');
const FONT = 'sans-serif';

// Sample data (worst-case): a long display name + the dev top-label + a full reward line.
const SAMPLE_NAME = 'Maximiliana the Everlasting Flame';
const SAMPLE_LABEL = 'Founder 000';
const SAMPLE_REWARDS = [
  'Medusa defeated!',
  'Rewards Obtained:',
  '+1,250,000 Credux  ·  +20,000 EXP  ·  +500 Belief Shards  ·  Boss Golden Chest',
  'Level Up!  Lv 49 → 50',
];

// Content zones as fractions of the locked frame (tunable; §5 open-decision #5).
const TOP_LABEL_BAND = { yFrac: 0.06, hFrac: 0.10, wFrac: 0.60 }; // profile word space
// The ornate result skins reserve their reward space in the CENTRAL bordered panel (the
// art draws VICTORY/DEFEATED + "Rewards Obtained" above it), NOT a bottom strip — verified
// visually against e_eternal_flame_r5. Per-skin override may still be needed (§10).
const REWARD_BAND = { yFrac: 0.50, hFrac: 0.20, wFrac: 0.72 };    // result reward space (central panel)

const results = []; // { name, status, notes }

function ensureOut() {
  fs.mkdirSync(OUT, { recursive: true });
}

async function loadNormalized(absPath) {
  const img = await loadImage(absPath); // webp/gif load their first frame
  const canvas = createCanvas(LOCKED.w, LOCKED.h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, LOCKED.w, LOCKED.h); // normalize to locked size (§6)
  return { canvas, ctx };
}

function save(name, canvas) {
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
}

function fits(ctx, text, maxW) {
  return ctx.measureText(text).width <= maxW;
}

async function previewProfile(key, absPath) {
  const notes = [];
  try {
    const { canvas, ctx } = await loadNormalized(absPath);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Top-label band.
    const labelY = LOCKED.h * (TOP_LABEL_BAND.yFrac + TOP_LABEL_BAND.hFrac / 2);
    const labelMaxW = LOCKED.w * TOP_LABEL_BAND.wFrac;
    ctx.font = `bold ${Math.round(LOCKED.h * 0.045)}px ${FONT}`;
    ctx.fillStyle = '#F5E6C8';
    ctx.fillText(SAMPLE_LABEL, LOCKED.w / 2, labelY);
    if (!fits(ctx, SAMPLE_LABEL, labelMaxW)) notes.push('top-label overflows band');

    // Display name (mid card).
    ctx.font = `bold ${Math.round(LOCKED.h * 0.05)}px ${FONT}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(SAMPLE_NAME, LOCKED.w / 2, LOCKED.h * 0.30);
    if (!fits(ctx, SAMPLE_NAME, LOCKED.w * 0.9)) notes.push('long name overflows');

    save(`profile__${key}`, canvas);
    results.push({ name: `profile/${key}`, status: notes.length ? 'WARN' : 'OK', notes });
  } catch (err) {
    results.push({ name: `profile/${key}`, status: 'FAIL', notes: [err.message] });
  }
}

async function previewPlain(category, key, absPath) {
  try {
    const { canvas } = await loadNormalized(absPath);
    save(`${category}__${key}`, canvas);
    results.push({ name: `${category}/${key}`, status: 'OK', notes: [] });
  } catch (err) {
    results.push({ name: `${category}/${key}`, status: 'FAIL', notes: [err.message] });
  }
}

async function previewResult(key, absVictory, absDefeated) {
  for (const [variant, abs] of [['victory', absVictory], ['defeated', absDefeated]]) {
    const notes = [];
    if (!abs) { results.push({ name: `result/${key}/${variant}`, status: 'FAIL', notes: ['missing file'] }); continue; }
    try {
      const { canvas, ctx } = await loadNormalized(abs);
      // Reward band (bottom reserved space).
      const bandX = LOCKED.w * (1 - REWARD_BAND.wFrac) / 2;
      const bandY = LOCKED.h * REWARD_BAND.yFrac;
      const bandW = LOCKED.w * REWARD_BAND.wFrac;
      const bandH = LOCKED.h * REWARD_BAND.hFrac;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const lh = bandH / (SAMPLE_REWARDS.length + 0.5);
      SAMPLE_REWARDS.forEach((line, i) => {
        ctx.font = `${i < 2 ? 'bold ' : ''}${Math.round(lh * 0.5)}px ${FONT}`;
        ctx.fillStyle = i === 0 ? '#43d675' : '#FFFFFF';
        const ly = bandY + lh * (i + 1);
        ctx.fillText(line, bandX, ly);
        if (!fits(ctx, line, bandW)) notes.push(`reward line ${i} overflows band width`);
        if (ly > LOCKED.h) notes.push(`reward line ${i} below frame`);
      });
      save(`result__${key}__${variant}`, canvas);
      results.push({ name: `result/${key}/${variant}`, status: notes.length ? 'WARN' : 'OK', notes });
    } catch (err) {
      results.push({ name: `result/${key}/${variant}`, status: 'FAIL', notes: [err.message] });
    }
  }
}

async function fromCatalog() {
  const { rows } = await pool.query('SELECT * FROM cosmetic_catalog ORDER BY category, tier, cosmetic_key');
  for (const r of rows) {
    if (r.category === 'profile') await previewProfile(r.cosmetic_key, skinFilePath(r.render_filename));
    else if (r.category === 'battle') await previewPlain('battle', r.cosmetic_key, skinFilePath(r.render_filename));
    else if (r.category === 'summon') await previewPlain('summon', r.cosmetic_key, skinFilePath(r.render_filename));
    else if (r.category === 'battle_result') {
      await previewResult(r.cosmetic_key, skinFilePath(r.victory_filename), skinFilePath(r.defeated_filename));
    }
  }
}

// Non-catalog sets: founder/ and testers/ + testers/<id>.
async function fromSetFolder(relFolder, tag) {
  const abs = path.join(SKINS_DIR, ...relFolder.split('/'));
  if (!fs.existsSync(abs)) return;
  const pick = (cands) => { for (const c of cands) { const p = path.join(abs, c); if (fs.existsSync(p)) return p; } return null; };
  const prof = pick(SET_FILES.profile);
  const batt = pick(SET_FILES.battle);
  const vic = pick(SET_FILES.victory);
  const def = pick(SET_FILES.defeated);
  const summ = pick(SET_FILES.summon);
  if (prof) await previewProfile(`set_${tag}`, prof);
  if (batt) await previewPlain('battle', `set_${tag}`, batt);
  if (vic || def) await previewResult(`set_${tag}`, vic, def);
  if (summ) await previewPlain('summon', `set_${tag}`, summ);
}

async function main() {
  ensureOut();
  try {
    await fromCatalog();
    await fromSetFolder(DIRS.founder, 'founder');
    await fromSetFolder(DIRS.testers, 'testers_default');
    // per-user custom folders
    const testersAbs = path.join(SKINS_DIR, ...DIRS.testers.split('/'));
    for (const ent of fs.readdirSync(testersAbs, { withFileTypes: true })) {
      if (ent.isDirectory()) await fromSetFolder(`${DIRS.testers}/${ent.name}`, `custom_${ent.name}`);
    }
  } finally {
    await pool.end();
  }

  const ok = results.filter((r) => r.status === 'OK').length;
  const warn = results.filter((r) => r.status === 'WARN');
  const fail = results.filter((r) => r.status === 'FAIL');
  console.log(`\n[skinPreview] ${results.length} previews → ${OUT}`);
  console.log(`  OK ${ok} · WARN ${warn.length} · FAIL ${fail.length}`);
  for (const r of [...warn, ...fail]) console.log(`  ${r.status}  ${r.name}  — ${r.notes.join('; ')}`);
  if (fail.length) process.exitCode = 1;
}

main();
