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
  SKINS_DIR, DIRS, BASE_ROWS, TOKEN_COSTS,
  parseStoreBasename, displayNameFromTokens, skinCode,
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

function buildEntries() {
  const entries = [];

  // ── Base set (one row per category, free) ─────────────────────────────────
  for (const b of BASE_ROWS) {
    // tier CHECK only allows believer/chosen/eternal; base rows are flagged by is_base=true
    // (always free + available to every supporter regardless of this nominal tier value).
    entries.push({
      cosmetic_key: b.key, category: b.category, tier: 'believer', is_base: true,
      display_name: 'Base ' + b.category.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      token_cost: 0, has_top_label: !!b.has_top_label,
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

  return entries;
}

async function main() {
  const entries = buildEntries();
  if (entries.length === 0) {
    console.error('[seedCosmetics] No skin files found under', SKINS_DIR);
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      // skin_code = the lowercase trailing token (p1/b2/r3/s2); null for base rows. §0 addendum2.
      const code = e.is_base ? null : (skinCode(e.cosmetic_key) || '').toLowerCase() || null;
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
    await client.query('COMMIT');

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

main();
