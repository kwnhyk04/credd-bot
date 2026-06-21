'use strict';

/**
 * skinResolver.js — render-time skin resolution (Supporter-stage §6, §7).
 *
 * resolveSkin(db, userId, category, { variant }) returns the on-disk frame to load
 * as the bottom canvas layer, by this precedence:
 *   1. equipped_skins.override_path   (dev / tester custom / founder set)
 *   2. equipped cosmetic_id           (shop/base catalog skin)
 *   3. base set                       (active supporter with nothing equipped)
 *   4. testers/ default set           (OPT-IN only, env BETA_MODE=true) — §7
 *   5. DEFAULT — default_template     (null → renderProfile's built-in default_template.png;
 *                                      the post-deploy default skin for ALL users)
 *
 * Returns { path|null, source, cosmetic|null }. A null path means "no skin override —
 * render exactly as before", so callers integrate without disturbing free players.
 *
 * override_path is stored relative to assets/skins/: a FILE for single-frame
 * categories (profile/battle/summon), or a FOLDER for battle_result (victory/defeated
 * resolved inside via SET_FILES). Cosmetic-only; never reads currency.
 */

const fs = require('fs');
const path = require('path');
const {
  SKINS_DIR, DIRS, SET_FILES, skinFilePath, DEV_ACCOUNT_IDS, BETA_MODE,
} = require('../config/cosmetics');
const {
  getEquipped, getCatalogById, getSupporter, isActiveSupporter,
} = require('./supporterEntitlements');

function existsAbs(p) {
  try { return p != null && fs.existsSync(p); } catch { return false; }
}

/** First existing file (absolute) among `candidates` basenames inside a skins-relative folder. */
function firstExistingInFolder(relFolder, candidates) {
  for (const name of candidates) {
    const abs = path.join(SKINS_DIR, ...relFolder.split('/'), name);
    if (existsAbs(abs)) return abs;
  }
  return null;
}

/** Resolve an override_path (file or folder) to the concrete frame for this category/variant. */
function resolveOverride(relPath, category, variant) {
  if (!relPath) return null;
  // A path with an extension is a concrete single file.
  if (path.extname(relPath)) {
    const abs = skinFilePath(relPath);
    return existsAbs(abs) ? abs : null;
  }
  // Otherwise it's a set folder — pick the file for this category/variant.
  let key = category;
  if (category === 'battle_result') key = variant === 'defeated' ? 'defeated' : 'victory';
  else if (category === 'summon') key = 'summon';
  return firstExistingInFolder(relPath, SET_FILES[key] || []);
}

/** Pull the right *_filename off a catalog row for the category/variant. */
function catalogFile(cat, category, variant) {
  if (!cat) return null;
  let rel;
  if (category === 'battle_result') rel = variant === 'defeated' ? cat.defeated_filename : cat.victory_filename;
  else rel = cat.render_filename;
  const abs = skinFilePath(rel);
  return existsAbs(abs) ? abs : null;
}

/**
 * @param {pool|client} db
 * @param {string} userId
 * @param {'profile'|'battle'|'battle_result'|'summon'} category
 * @param {{variant?: 'victory'|'defeated'}} [opts]
 * @returns {Promise<{ path: string|null, source: string, cosmetic: object|null }>}
 */
async function resolveSkin(db, userId, category, opts = {}) {
  const variant = opts.variant || 'victory';
  const equipped = await getEquipped(db, userId);
  const eq = equipped[category];

  // 1. override_path
  if (eq && eq.override_path) {
    const p = resolveOverride(eq.override_path, category, variant);
    if (p) return { path: p, source: 'override', cosmetic: null };
  }

  // 2. equipped catalog cosmetic
  if (eq && eq.cosmetic_id != null) {
    const cat = await getCatalogById(db, eq.cosmetic_id);
    const p = catalogFile(cat, category, variant);
    if (p) return { path: p, source: cat && cat.is_base ? 'base' : 'equipped', cosmetic: cat };
  }

  // 3. base set fallback for an active supporter who has nothing equipped here
  const sup = await getSupporter(db, userId);
  if (isActiveSupporter(sup)) {
    const { rows } = await db.query(
      'SELECT * FROM cosmetic_catalog WHERE is_base = true AND category = $1 LIMIT 1', [category]
    );
    const p = catalogFile(rows[0], category, variant);
    if (p) return { path: p, source: 'base', cosmetic: rows[0] };
  }

  // 4. OPT-IN beta default (testers/) — only when env BETA_MODE=true. Off by default so an
  //    unequipped account never silently renders a tester skin.
  if (BETA_MODE) {
    let key = category;
    if (category === 'battle_result') key = variant === 'defeated' ? 'defeated' : 'victory';
    else if (category === 'summon') key = 'summon';
    const p = firstExistingInFolder(DIRS.testers, SET_FILES[key] || []);
    if (p) return { path: p, source: 'beta', cosmetic: null };
  }

  // 5. DEFAULT — the shared default template. null tells renderProfile to use its built-in
  //    default_template.png (and the battle/summon renderers their built-in defaults). This is
  //    THE default skin for every user post-deploy; `crd set all skin default` lands here.
  return { path: null, source: 'default', cosmetic: null };
}

/**
 * §6 profile top-label: the word drawn in the profile's top space.
 *   - dev accounts → "Founder 000"
 *   - founders     → "Founder NNN" (zero-padded founder_number)
 *   - else         → the tier name ("Believer"/"Chosen"/"Eternal")
 * Returns { hasTopLabel, word } — hasTopLabel comes from the equipped profile skin's
 * catalog flag (base/store), defaulting false for free players.
 */
async function resolveProfileLabel(db, userId) {
  // Dev accounts always render Founder 000.
  if (DEV_ACCOUNT_IDS.includes(String(userId))) {
    return { hasTopLabel: true, word: 'Founder 000' };
  }
  const sup = await getSupporter(db, userId);
  if (!isActiveSupporter(sup)) return { hasTopLabel: false, word: null };

  let word;
  if (sup.founder_number != null) word = `Founder ${String(sup.founder_number).padStart(3, '0')}`;
  else word = sup.tier.charAt(0).toUpperCase() + sup.tier.slice(1);

  // hasTopLabel from the equipped profile skin (override sets have the label space too).
  const equipped = await getEquipped(db, userId);
  const eq = equipped.profile;
  let hasTopLabel = true; // supporters render the label by default
  if (eq && eq.cosmetic_id != null) {
    const cat = await getCatalogById(db, eq.cosmetic_id);
    if (cat) hasTopLabel = !!cat.has_top_label;
  }
  return { hasTopLabel, word };
}

module.exports = { resolveSkin, resolveProfileLabel };
