'use strict';

/**
 * seedCosmetics.js — populate `cosmetic_catalog` from the on-disk skin assets
 * (Supporter-stage spec §2). Idempotent: upserts every present skin by
 * cosmetic_key, and flips is_active=false for catalog rows whose files are gone.
 *
 *   node scripts/seedCosmetics.js
 *
 * Parses filenames via src/config/cosmetics.parseStoreBasename (position-based,
 * §1). Stores *_filename columns as forward-slash paths relative to assets/skins/.
 * Hand-writes NOTHING — the catalog is derived from the real filenames so it can
 * never drift from what's on disk.
 */

const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');
const {
  SKINS_DIR, DIRS, BASE_ROWS, TOKEN_COSTS, PRICE_OVERRIDES, SET_FILES,
  TESTER_PROFILE_VARIANTS, parseStoreBasename, displayNameFromTokens, skinCode,
} = require('../src/config/cosmetics');

// List the basenames (with ext) of regular files directly under a skins-relative dir.
function listFiles(relDir, exts) {
  const abs = path.join(SKINS_DIR, ...relDir.split('/'));
  let ents;
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); }
  catch { return []; }
  return ents
    .filter((e) => e.isFile() && exts.includes(path.extname(e.name).toLowerCase()))
    .map((e) => ({ name: e.name, rel: `${relDir}/${e.name}`, base: path.basename(e.name, path.extname(e.name)) }));
}

// Strip a leading tier letter (b_/c_/e_) so img-preview names match the skin name regardless
// of the tier prefix drift in the asset folders (e.g. result img `e_altar_light` ↔ skin `c_..`).
function nameKeyOf(basename) {
  const toks = basename.split('_').filter(Boolean);
  if (toks.length > 1 && ['b', 'c', 'e'].includes(toks[0])) toks.shift();
  return toks.join('_');
}

// Category → short letter, used to mint equip codes for non-store sets.
// Convention (no dashes): base `<L>b`, beta(tester_default) `<L>b1`, tester N `<L>t<N>`.
const CAT_LETTER = { profile: 'p', battle: 'b', battle_result: 'r', summon: 's' };

// Founder set uses fixed two-letter equip codes.
const FOUNDER_CODE = { profile: 'fp', battle: 'bp', battle_result: 'rf', summon: 'sf' };

// Themed store sets that don't follow the position-based store filename convention
// (ph/norse/greek). Profile + battle only — seeded explicitly as purchasable shop rows.
const THEMED_STORE = [
  { theme: 'ph', display: 'Philippine Mythos', tier: 'chosen', pcode: 'p5', bcode: 'b7' },
  { theme: 'norse', display: 'Norse Mythos', tier: 'chosen', pcode: 'p6', bcode: 'b8' },
  { theme: 'greek', display: 'Greek Mythos', tier: 'chosen', pcode: 'p7', bcode: 'b9' },
];

// Pick the first present basename for a category inside a skins-relative set folder.
function pickSetFile(relFolder, key) {
  for (const cand of SET_FILES[key] || []) {
    const abs = path.join(SKINS_DIR, ...relFolder.split('/'), cand);
    if (fs.existsSync(abs)) return `${relFolder}/${cand}`;
  }
  return null;
}

/**
 * Seed a non-store "set" folder (founder/ or testers/<id>/ or the testers/ default) as catalog
 * rows so the skins show up in the collection. Ownership is by scope (cosmetic_key prefix),
 * resolved in supporterEntitlements.ownedIdsResolved — these rows never appear in the shop.
 */
function setFolderEntries(relFolder, keyPrefix, tier, label, codeFor) {
  const out = [];
  const push = (cat, rel, extra = {}) => out.push({
    cosmetic_key: `${keyPrefix}_${cat}`, category: cat, tier, is_base: false,
    display_name: `${label} ${cat.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`,
    token_cost: 0, has_top_label: cat === 'profile', skin_code: codeFor(cat),
    render_filename: null, victory_filename: null, defeated_filename: null,
    display_filename: null, ...extra,
  });

  const prof = pickSetFile(relFolder, 'profile');
  if (prof) push('profile', prof, { render_filename: prof, display_filename: prof });
  const batt = pickSetFile(relFolder, 'battle');
  if (batt) push('battle', batt, { render_filename: batt, display_filename: batt });
  const vic = pickSetFile(relFolder, 'victory');
  const def = pickSetFile(relFolder, 'defeated');
  if (vic || def) push('battle_result', vic || def, { victory_filename: vic, defeated_filename: def, display_filename: vic || def });
  const summ = pickSetFile(relFolder, 'summon');
  if (summ) push('summon', summ, { render_filename: summ, display_filename: summ });
  return out;
}

// Founder set (dev-owned, limited) + tester default (everyone, beta) + per-tester custom folders.
function nonStoreEntries() {
  const out = [];
  out.push(...setFolderEntries(DIRS.founder, 'founder', 'eternal', 'Founder', (cat) => FOUNDER_CODE[cat]));
  out.push(...setFolderEntries(DIRS.testers, 'tester_default', 'believer', 'Beta', (cat) => `${CAT_LETTER[cat]}b1`));
  const testersAbs = path.join(SKINS_DIR, ...DIRS.testers.split('/'));
  try {
    // Numeric-sorted folder order so each tester keeps a stable index (pt1..ptN)
    // regardless of filesystem listing; a newer (larger) discord id sorts last.
    const dirs = fs.readdirSync(testersAbs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
    let idx = 0;
    for (const name of dirs) {
      idx += 1; // per-tester equip codes pt1/bt1/rt1/st1, pt2/… by numeric id order
      out.push(...setFolderEntries(`${DIRS.testers}/${name}`, `tester_${name}`, 'believer', 'Tester', (cat) => `${CAT_LETTER[cat]}t${idx}`));
    }
  } catch { /* no testers dir */ }
  return out;
}

function r2OnlyTesterProfileEntries() {
  return TESTER_PROFILE_VARIANTS.map((variant) => {
    const entry = { ...variant };
    delete entry.layout_source_filename;
    return entry;
  });
}

function buildEntries() {
  const entries = [];

  // ── Base set (one row per category, free) ─────────────────────────────────
  for (const b of BASE_ROWS) {
    // tier CHECK only allows believer/chosen/eternal; base rows are flagged by is_base=true
    // (always free + available to every supporter regardless of this nominal tier value).
    entries.push({
      cosmetic_key: b.key, category: b.category, tier: 'believer', is_base: true,
      display_name: 'Base ' + b.category.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      token_cost: 0, has_top_label: !!b.has_top_label, skin_code: `${CAT_LETTER[b.category]}b`,
      render_filename: b.render || null,
      victory_filename: b.victory || null,
      defeated_filename: b.defeated || null,
      display_filename: b.render || b.victory || null,
    });
  }

  // ── Profile skins (render doubles as preview; top-label space present) ─────
  for (const f of listFiles(DIRS.storeProfile, ['.png'])) {
    const p = parseStoreBasename(f.base);
    if (!p || p.category !== 'profile') continue;
    entries.push({
      cosmetic_key: f.base, category: 'profile', tier: p.tier, is_base: false,
      display_name: p.displayName, token_cost: TOKEN_COSTS[p.tier], has_top_label: true,
      render_filename: f.rel, display_filename: f.rel,
      victory_filename: null, defeated_filename: null,
    });
  }

  // ── Battle skins (render doubles as preview) ───────────────────────────────
  for (const f of listFiles(DIRS.storeBattle, ['.png'])) {
    const p = parseStoreBasename(f.base);
    if (!p || p.category !== 'battle') continue;
    entries.push({
      cosmetic_key: f.base, category: 'battle', tier: p.tier, is_base: false,
      display_name: p.displayName, token_cost: TOKEN_COSTS[p.tier], has_top_label: false,
      render_filename: f.rel, display_filename: f.rel,
      victory_filename: null, defeated_filename: null,
    });
  }

  // ── Battle-result skins: group victory + defeated by increment r<N> ────────
  const resultImg = listFiles(DIRS.storeResultImg, ['.png']);
  const groups = new Map(); // increment → { victory, defeated, tier, nameTokens }
  for (const f of listFiles(DIRS.storeResult, ['.png'])) {
    const p = parseStoreBasename(f.base);
    if (!p || p.category !== 'battle_result') continue;
    const g = groups.get(p.increment) || { increment: p.increment };
    g[p.variant] = f.rel;
    // Prefer the victory file's tier/name as canonical (defeated may carry a typo'd name).
    if (p.variant === 'victory' || !g.tier) { g.tier = p.tier; g.nameTokens = p.nameTokens; }
    groups.set(p.increment, g);
  }
  for (const g of [...groups.values()].sort((a, b) => a.increment - b.increment)) {
    const nameKey = g.nameTokens.join('_');
    const img = resultImg.find((i) => nameKeyOf(i.base) === nameKey);
    entries.push({
      cosmetic_key: `${g.tier[0]}_${nameKey}_r${g.increment}`,
      category: 'battle_result', tier: g.tier, is_base: false,
      display_name: displayNameFromTokens(g.nameTokens), token_cost: TOKEN_COSTS[g.tier],
      has_top_label: false,
      render_filename: null,
      victory_filename: g.victory || null,
      defeated_filename: g.defeated || null,
      display_filename: img ? img.rel : (g.victory || null),
    });
  }

  // ── Summon flip skins (webp render; preview in card_flip/img) ──────────────
  const flipImg = listFiles(DIRS.storeFlipImg, ['.png']);
  for (const f of listFiles(DIRS.storeFlip, ['.webp'])) {
    const p = parseStoreBasename(f.base);
    if (!p || p.category !== 'summon') continue;
    const img = flipImg.find((i) => nameKeyOf(i.base) === p.nameTokens.join('_'));
    entries.push({
      cosmetic_key: f.base, category: 'summon', tier: p.tier, is_base: false,
      display_name: p.displayName, token_cost: TOKEN_COSTS[p.tier], has_top_label: false,
      render_filename: f.rel, display_filename: img ? img.rel : f.rel,
      victory_filename: null, defeated_filename: null,
    });
  }

  // ── Themed store sets (ph/norse/greek) — profile + battle only (no result/summon).
  //    Plain filenames don't match the tier_name_<cat><n> store convention, so seed them
  //    explicitly as purchasable shop rows with their own equip/buy codes.
  for (const t of THEMED_STORE) {
    const prof = `${DIRS.storeProfile}/${t.theme}_profile.png`;
    if (fs.existsSync(path.join(SKINS_DIR, ...prof.split('/')))) {
      entries.push({
        cosmetic_key: `${t.theme}_profile`, category: 'profile', tier: t.tier, is_base: false,
        display_name: t.display, token_cost: TOKEN_COSTS[t.tier], has_top_label: true,
        render_filename: prof, display_filename: prof, victory_filename: null, defeated_filename: null,
        skin_code: t.pcode,
      });
    }
    const batt = `${DIRS.storeBattle}/${t.theme}_battle.png`;
    if (fs.existsSync(path.join(SKINS_DIR, ...batt.split('/')))) {
      entries.push({
        cosmetic_key: `${t.theme}_battle`, category: 'battle', tier: t.tier, is_base: false,
        display_name: t.display, token_cost: TOKEN_COSTS[t.tier], has_top_label: false,
        render_filename: batt, display_filename: batt, victory_filename: null, defeated_filename: null,
        skin_code: t.bcode,
      });
    }
  }

  // ── Non-store sets (founder / tester default / per-tester customs) ─────────
  entries.push(...nonStoreEntries());

  // R2-only tester variants are explicit catalog rows: they may not exist in a
  // GitHub checkout, but must remain active when the catalog is reseeded.
  entries.push(...r2OnlyTesterProfileEntries());

  // ── [Patch 2 §2.1] Class default BATTLE skins — synthetic rows NOT derived
  // from disk (assets live on R2). Mirrors patch2-classbattle-backfill.sql so
  // the deactivation pass below never flips them off on a reseed. Bases sit at
  // BUCKET-ROOT classes/battle_base/ (no skins/ prefix — render code special-
  // cases it). Founder/tester AVATARS live in avatar_catalog, NOT here.
  const CLASS_BATTLE = [
    ['swordsman', 'ws'], ['fighter', 'fs'], ['mage', 'ms'], ['knight', 'ks'], ['archer', 'as'],
  ];
  for (const [cls, code] of CLASS_BATTLE) {
    const rel = `classes/battle_base/${cls}.png`;
    entries.push({
      cosmetic_key: `class_battle_${cls}`, category: 'battle', tier: 'believer', is_base: false,
      display_name: `${cls.charAt(0).toUpperCase()}${cls.slice(1)} Battle`,
      token_cost: 0, has_top_label: false, skin_code: code,
      render_filename: rel, display_filename: rel, victory_filename: null, defeated_filename: null,
    });
  }

  return entries;
}

async function main() {
  const entries = buildEntries();
  if (entries.length === 0) {
    console.error('[seedCosmetics] No skin files found under', SKINS_DIR);
    process.exit(1);
  }

  // Apply per-skin price overrides (initial-release reprice) so reseeds keep the new prices.
  for (const e of entries) {
    if (PRICE_OVERRIDES[e.cosmetic_key] != null) e.token_cost = PRICE_OVERRIDES[e.cosmetic_key];
  }

  if (process.argv.includes('--dry')) {
    // Dry run: print what WOULD be seeded (no DB connection), for verifying codes.
    for (const e of entries) {
      const code = e.skin_code !== undefined ? e.skin_code : ((skinCode(e.cosmetic_key) || '').toLowerCase() || null);
      console.log(`${(code || '—').padEnd(6)} ${e.category.padEnd(14)} ${String(e.tier).padEnd(9)} cost=${e.token_cost}  ${e.cosmetic_key}`);
    }
    console.log(`\n[dry] ${entries.length} rows (no DB writes).`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      // Equip code: an explicit per-set code (base-p / fdr-b / t1-r / beta-p) when the entry carries
      // one, else the store skin's trailing token (p1/b2/r3/s2). Every row now has an equip ID.
      const code = e.skin_code !== undefined
        ? e.skin_code
        : ((skinCode(e.cosmetic_key) || '').toLowerCase() || null);
      await client.query(
        `INSERT INTO cosmetic_catalog
           (cosmetic_key, category, tier, display_name, token_cost, is_base, has_top_label,
            display_filename, render_filename, victory_filename, defeated_filename, skin_code, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
         ON CONFLICT (cosmetic_key) DO UPDATE SET
           category=EXCLUDED.category, tier=EXCLUDED.tier, display_name=EXCLUDED.display_name,
           token_cost=EXCLUDED.token_cost, is_base=EXCLUDED.is_base, has_top_label=EXCLUDED.has_top_label,
           display_filename=EXCLUDED.display_filename, render_filename=EXCLUDED.render_filename,
           victory_filename=EXCLUDED.victory_filename, defeated_filename=EXCLUDED.defeated_filename,
           skin_code=EXCLUDED.skin_code, is_active=true`,
        [e.cosmetic_key, e.category, e.tier, e.display_name, e.token_cost, e.is_base, e.has_top_label,
         e.display_filename, e.render_filename, e.victory_filename, e.defeated_filename, code]
      );
    }
    // Deactivate any catalog row whose key is no longer produced from disk.
    const keys = entries.map((e) => e.cosmetic_key);
    const deact = await client.query(
      'UPDATE cosmetic_catalog SET is_active=false WHERE cosmetic_key <> ALL($1) AND is_active=true RETURNING cosmetic_key',
      [keys]
    );

    // Auto-equip each tester's own set to their discord_id for any category they
    // haven't set yet. Runtime `crd set all skin default` still resets at will; a
    // later re-seed only re-fills categories that are currently empty (ON CONFLICT
    // DO NOTHING), so a tester's custom/reset choice is never overwritten.
    const testersAbs = path.join(SKINS_DIR, ...DIRS.testers.split('/'));
    let tdirs = [];
    try {
      tdirs = fs.readdirSync(testersAbs, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name);
    } catch { /* none */ }
    let equipped = 0;
    for (const id of tdirs) {
      const res = await client.query(
        `INSERT INTO equipped_skins (discord_id, category, cosmetic_id, override_path, updated_at)
           SELECT $1, selected.category, selected.cosmetic_id, NULL, NOW()
             FROM (
               SELECT DISTINCT ON (c.category) c.category, c.cosmetic_id
                 FROM cosmetic_catalog c
                WHERE c.is_active = true AND c.cosmetic_key LIKE $2
                ORDER BY c.category,
                         CASE
                           WHEN c.cosmetic_key = 'tester_' || $1 || '_' || c.category THEN 0
                           ELSE 1
                         END,
                         c.cosmetic_key
             ) selected
         ON CONFLICT (discord_id, category) DO NOTHING`,
        [id, `tester_${id}_%`]
      );
      equipped += res.rowCount;
    }

    await client.query('COMMIT');
    if (equipped) console.log('[seedCosmetics] auto-equipped tester defaults:', equipped, 'category rows');

    // Summary by category/tier.
    const tally = {};
    for (const e of entries) {
      const k = `${e.category}/${e.tier}`;
      tally[k] = (tally[k] || 0) + 1;
    }
    console.log('[seedCosmetics] upserted', entries.length, 'catalog rows:');
    for (const k of Object.keys(tally).sort()) console.log('   ', k.padEnd(24), tally[k]);
    if (deact.rowCount) console.log('[seedCosmetics] deactivated (files gone):', deact.rows.map((r) => r.cosmetic_key).join(', '));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[seedCosmetics] FAILED — nothing committed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main();

module.exports = { buildEntries, r2OnlyTesterProfileEntries };
