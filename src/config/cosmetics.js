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
const SKINS_DIR = path.resolve(__dirname, '..', '..', 'assets', 'skins');

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

// Per-skin price overrides (cosmetic_key → token_cost). Applied AFTER the tier default in the
// seeder, so these survive a reseed. Initial-release reprice: the premium myth + eternal store
// skins cost 6; the budget "chosen" ones stay at their tier price (3). Keys mirror the catalog.
const PRICE_OVERRIDES = {
  // Profile (Divine Radiance / Laurel Runes Blue intentionally stay at 3)
  greek_profile: 6, ph_profile: 6, norse_profile: 6,
  e_aurora_constellation_p3: 6, e_eternal_flame_p4: 6,
  // Battle (3 Chosen arena skins stay at 3)
  greek_battle: 6, ph_battle: 6, norse_battle: 6,
  e_astral_duel_b4: 6, e_celestial_clash_b5: 6, e_eternal_arena_b6: 6,
  // Battle result (Laurel Crown stays at 3)
  c_altar_light_r1: 6, e_aurora_sovereign_r3: 6, e_celestial_triump_r4: 6, e_eternal_flame_r5: 6,
  // Summon (Rune Glow stays at 3)
  e_aurora_ribbon_s2: 6, e_eternal_supernova_s3: 6, e_stardust_constellation_s4: 6,
};
// Monthly stipend by tier; eternal is a ONE-TIME grant at founder purchase.
// [Patch 2 §2.3] believer 2/mo, chosen 4/mo, eternal 20 one-time (was 1/3/18).
const MONTHLY_TOKENS = { believer: 2, chosen: 4 };
const ETERNAL_ONE_TIME_TOKENS = 20;

// [Patch 2 §2.5] Supporter badge drawn below the Title on profile/stats cards.
// Height in px; width scales proportionally. Assets live at
// skins/supporters/badge/<file>.png (verified upload layout); the eternal tier
// uses the founder badge art.
const SUPPORTER_BADGE_HEIGHT = 96;
const SUPPORTER_BADGE_DIR = 'skins/supporters/badge';
const SUPPORTER_BADGE_FILE = { believer: 'believer', chosen: 'chosen', eternal: 'founder' };

// ── Beta / dev config (§7, §8, §6 top-label) ────────────────────────────────
// DEFAULT (post-deploy, all users): an account with nothing equipped renders the shared default
// template (assets/profile/default_template.png) via renderProfile's built-in art — NOT a skin.
// BETA_MODE is an OPT-IN override (set env BETA_MODE=true) that instead renders the testers/
// default set for unequipped accounts. Off by default so "default" always means default_template.
const BETA_MODE = String(process.env.BETA_MODE ?? 'false').toLowerCase() === 'true';
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
  stats: ['profile.png', 'founder_profile.png'],
  battle: ['battle.png', 'founder_battle.png'],
  victory: ['victory.png', 'green_victory.png', 'founder_victory.png'],
  defeated: ['defeated.png', 'founder_defeated.png'],
  summon: ['ember_spark_flip.webp', 'summon.gif', 'summon.webp', 'founder_summon.webp'],
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
  const raw = String(relPath).trim();
  if (!raw || path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) return null;

  const parts = raw.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) return null;

  const abs = path.resolve(SKINS_DIR, ...parts);
  const rel = path.relative(SKINS_DIR, abs);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return abs;
  return null;
}

/** Relative (forward-slash) skins path from an absolute/native path under SKINS_DIR. */
function toRelSkinPath(absPath) {
  const abs = path.resolve(absPath);
  const rel = path.relative(SKINS_DIR, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

module.exports = {
  SKINS_DIR,
  CATEGORIES,
  CATEGORY_LETTER,
  TIER_LETTER,
  TIER_RANK,
  TOKEN_COSTS,
  PRICE_OVERRIDES,
  MONTHLY_TOKENS,
  ETERNAL_ONE_TIME_TOKENS,
  SUPPORTER_BADGE_HEIGHT,
  SUPPORTER_BADGE_DIR,
  SUPPORTER_BADGE_FILE,
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
