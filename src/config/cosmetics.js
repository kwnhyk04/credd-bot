'use strict';

/**
 * cosmetics.js — shared constants + filename parser + path resolver for the
 * Supporter Shop / skin system (Supporter-stage spec §1–§8).
 *
 * Cosmetic-only: nothing here grants credux, items, or any combat advantage.
 * The catalog rows live in the `cosmetic_catalog` DB table (seeded by
 * scripts/seedCosmetics.js); this module is the single source of truth for the
 * directory layout, the filename convention, token economy constants, and the
 * `category → on-disk path` resolution that the seeder, shop, render pipeline,
 * and dev commands all share.
 *
 * IMPORTANT: the catalog stores `render_filename` / `victory_filename` /
 * `defeated_filename` / `display_filename` as paths RELATIVE TO assets/skins/
 * (forward-slash), e.g. `supporters/supporter_store/profile/c_divine_radiance_p1.png`.
 * `skinFilePath(relPath)` joins them onto the absolute skins dir. This keeps
 * base/store/founder/tester art resolvable through one code path.
 */

const path = require('path');
const { DEV_IDS } = require('./config');

// assets/skins/ — anchored to project root (this file is src/config/).
const SKINS_DIR = path.join(__dirname, '..', '..', 'assets', 'skins');

// The four cosmetic categories (also the equipped_skins.category / catalog.category values).
const CATEGORIES = ['profile', 'battle', 'battle_result', 'summon'];

// Last-token category letter → category. NOTE the believer tier letter `b` collides with
// the battle category letter `b`; the parser disambiguates by POSITION (first token = tier,
// last token = <category-letter><increment>) — never match a bare letter.
const CATEGORY_LETTER = { p: 'profile', b: 'battle', r: 'battle_result', s: 'summon' };

// First-token tier letter → tier name.
const TIER_LETTER = { b: 'believer', c: 'chosen', e: 'eternal' };

// Tier gate ranking — a supporter may buy/equip skins of their tier and below (§5).
const TIER_RANK = { base: 0, believer: 1, chosen: 2, eternal: 3 };

// ── Economy constants (all adjustable; §2/§3) ───────────────────────────────
// Shop price by tier (token_cost). Base set is free.
const TOKEN_COSTS = { believer: 2, chosen: 3, eternal: 4 };
// Monthly stipend by tier; eternal is a ONE-TIME grant at founder purchase (= 6 × the
// 3-month window). Flag in the prompt: switch eternal to 6/month over 3 months if preferred.
const MONTHLY_TOKENS = { believer: 1, chosen: 3 };
const ETERNAL_ONE_TIME_TOKENS = 18;

// ── Beta / dev config (§7, §8, §6 top-label) ────────────────────────────────
// While BETA_MODE is on, an account with nothing equipped renders the testers/ default set.
const BETA_MODE = String(process.env.BETA_MODE ?? 'true').toLowerCase() !== 'false';
// The two dev accounts render the profile top-label as `Founder 000`. Human supplies the IDs
// via env DEV_ACCOUNT_IDS (comma-separated); falls back to DEV_IDS.
const DEV_ACCOUNT_IDS = (process.env.DEV_ACCOUNT_IDS
  ? process.env.DEV_ACCOUNT_IDS.split(',').map((s) => s.trim()).filter(Boolean)
  : DEV_IDS);

// Locked render size — every resolved frame is normalized to this so source drift can't break fit (§6).
const LOCKED = { w: 1536, h: 1024 };

// ── Directory layout (relative to SKINS_DIR, forward-slash) ─────────────────
const DIRS = {
  base: 'supporters/base',
  store: 'supporters/supporter_store',
  storeProfile: 'supporters/supporter_store/profile',
  storeBattle: 'supporters/supporter_store/battle',
  storeResult: 'supporters/supporter_store/battle/result',
  storeResultImg: 'supporters/supporter_store/battle/result/img',
  storeFlip: 'supporters/supporter_store/card_flip',
  storeFlipImg: 'supporters/supporter_store/card_flip/img',
  testers: 'testers',
  founder: 'founder',
};

// Base set — one catalog row per category (is_base=true, token_cost=0).
const BASE_ROWS = [
  { key: 'base_profile', category: 'profile',       render: 'supporters/base/profile.png',  has_top_label: true },
  { key: 'base_battle',  category: 'battle',        render: 'supporters/base/battle.png' },
  { key: 'base_result',  category: 'battle_result', victory: 'supporters/base/victory.png', defeated: 'supporters/base/defeated.png' },
  { key: 'base_flip',    category: 'summon',        render: 'supporters/base/ember_spark_flip.webp' },
];

// Per-category file basenames for a "set" folder (base, founder, testers/<id>). Used to
// auto-equip a whole set via override_path. victory/defeated fall back across naming variants.
const SET_FILES = {
  profile: ['profile.png', 'founder_profile.png'],
  battle: ['battle.png', 'founder_battle.png'],
  victory: ['victory.png', 'green_victory.png', 'founder_victory.png'],
  defeated: ['defeated.png', 'founder_defeated.png'],
  summon: ['ember_spark_flip.webp', 'summon.gif', 'summon.webp'],
};

// Display title-casing: apostrophes + a couple of asset-filename typo fixes so the storefront
// reads cleanly without renaming art on disk.
const APOSTROPHE = { champions: "Champion's" };
const DISPLAY_FIX = { lauren: 'Laurel', triump: 'Triumph' };

function titleCaseToken(tok) {
  if (APOSTROPHE[tok]) return APOSTROPHE[tok];
  const fixed = DISPLAY_FIX[tok] || tok;
  return fixed.charAt(0).toUpperCase() + fixed.slice(1);
}

/** "champions_arena" → "Champion's Arena"; tolerates the asset typos above. */
function displayNameFromTokens(tokens) {
  return tokens.map(titleCaseToken).join(' ');
}

/**
 * Parse a STORE skin basename (no extension) by POSITION (§1):
 *   first token = tier (b/c/e); last token = <category-letter><increment>;
 *   battle_result carries a `victory|defeated` token just before the `r<N>`;
 *   middle tokens = the skin name.
 * @returns {null | { tier, category, increment, variant, nameTokens, displayName }}
 */
function parseStoreBasename(basename) {
  const tokens = String(basename).split('_').filter(Boolean);
  if (tokens.length < 3) return null;

  const tier = TIER_LETTER[tokens[0]];
  if (!tier) return null;

  const last = tokens[tokens.length - 1];
  const m = /^([pbrs])(\d+)$/.exec(last);
  if (!m) return null;
  const category = CATEGORY_LETTER[m[1]];
  const increment = parseInt(m[2], 10);

  let variant = null;
  let nameTokens;
  if (category === 'battle_result') {
    const maybeVariant = tokens[tokens.length - 2];
    if (maybeVariant !== 'victory' && maybeVariant !== 'defeated') return null;
    variant = maybeVariant;
    nameTokens = tokens.slice(1, tokens.length - 2);
  } else {
    nameTokens = tokens.slice(1, tokens.length - 1);
  }
  if (nameTokens.length === 0) return null;

  return { tier, category, increment, variant, nameTokens, displayName: displayNameFromTokens(nameTokens) };
}

/**
 * The short increment id shown in the shop / skin list (e.g. "P1", "B1", "R1", "S1"),
 * pulled from the trailing `<category-letter><increment>` of the cosmetic_key. Base rows
 * (no such suffix) return null.
 */
function skinCode(cosmeticKey) {
  const m = /_([pbrs]\d+)$/i.exec(String(cosmeticKey));
  return m ? m[1].toUpperCase() : null;
}

/** Absolute on-disk path for a catalog *_filename (relative to assets/skins/). */
function skinFilePath(relPath) {
  if (!relPath) return null;
  return path.join(SKINS_DIR, ...String(relPath).split('/'));
}

/** Relative (forward-slash) skins path from an absolute/native path under SKINS_DIR. */
function toRelSkinPath(absPath) {
  return path.relative(SKINS_DIR, absPath).split(path.sep).join('/');
}

module.exports = {
  SKINS_DIR,
  CATEGORIES,
  CATEGORY_LETTER,
  TIER_LETTER,
  TIER_RANK,
  TOKEN_COSTS,
  MONTHLY_TOKENS,
  ETERNAL_ONE_TIME_TOKENS,
  BETA_MODE,
  DEV_ACCOUNT_IDS,
  LOCKED,
  DIRS,
  BASE_ROWS,
  SET_FILES,
  displayNameFromTokens,
  parseStoreBasename,
  skinCode,
  skinFilePath,
  toRelSkinPath,
};
