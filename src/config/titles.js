'use strict';

/**
 * Title grant conditions (v5 Phase 5). Tune freely — codes must match title_catalog.
 * PNG art is optional per title (title_catalog.image_filename); these only define
 * WHO earns WHAT, never how it renders.
 */

// Believer level → title code (granted as believer_level rises; all ≤ level are owned).
const BELIEVER_TITLE_THRESHOLDS = [
  { level: 1,   code: 'believer_wanderer' },
  { level: 10,  code: 'believer_devotee' },
  { level: 25,  code: 'believer_disciple' },
  { level: 50,  code: 'believer_zealot' },
  { level: 100, code: 'believer_champion_of_faith' },
  { level: 200, code: 'believer_chosen_one' },
  { level: 500, code: 'believer_last_believer' },
];

// boss_kills (participation) → feat title code.
const BOSS_FEAT_THRESHOLDS = [
  { kills: 50,   code: 'feat_godslayer' },
  { kills: 200,  code: 'feat_world_ender' },
  { kills: 400,  code: 'feat_deicide' },
  { kills: 700,  code: 'feat_ragnarok_bringer' },
  { kills: 1000, code: 'feat_eternal_vanquisher' },
];

// Collection: own every available deity.
const COLLECTION_PANTHEON_KEEPER = 'coll_pantheon_keeper';
// Own every deity of a single mythology (deity_roster.mythology → title code).
const MYTHOLOGY_COLLECTION = {
  PH: 'coll_ph_keeper',
  Norse: 'coll_norse_keeper',
  Greek: 'coll_greek_keeper',
};

// Celestial receives the exclusive rotating title using the existing catalog codes.
// Every lower bracket receives a generic per-season title.
const CELESTIAL_SEASON_TITLES = [
  'divine_embercrowned',
  'divine_fimbulwinter',
  'divine_tempest_amihan',
  'divine_asphodel',
  'divine_hand_of_sidapa',
  'divine_last_dawn',
];

// Dropdown categories for `crd title` → title_catalog.source value(s).
const TITLE_CATEGORIES = [
  { key: 'believer',    label: 'Believer',   sources: ['believer'] },
  { key: 'rank_season', label: 'Season',     sources: ['rank_season'] },
  { key: 'boss_feat',   label: 'Boss Feats', sources: ['boss_feat'] },
  { key: 'collection',  label: 'Collection', sources: ['collection'] },
  { key: 'event',       label: 'Event',      sources: ['event'] },
];

/** Believer title codes earned at or below a level. */
function believerTitlesFor(level) {
  return BELIEVER_TITLE_THRESHOLDS.filter((t) => level >= t.level).map((t) => t.code);
}

/** Boss-feat title codes earned at or below a kill count. */
function bossFeatTitlesFor(kills) {
  return BOSS_FEAT_THRESHOLDS.filter((t) => kills >= t.kills).map((t) => t.code);
}

/** Celestial season title for a 1-based season number (rotates, wraps). */
function celestialSeasonTitle(seasonNumber) {
  const idx = (Math.max(1, seasonNumber) - 1) % CELESTIAL_SEASON_TITLES.length;
  return CELESTIAL_SEASON_TITLES[idx];
}

module.exports = {
  BELIEVER_TITLE_THRESHOLDS,
  BOSS_FEAT_THRESHOLDS,
  COLLECTION_PANTHEON_KEEPER,
  MYTHOLOGY_COLLECTION,
  CELESTIAL_SEASON_TITLES,
  TITLE_CATEGORIES,
  believerTitlesFor,
  bossFeatTitlesFor,
  celestialSeasonTitle,
  DIVINE_SEASON_TITLES: CELESTIAL_SEASON_TITLES,
  divineSeasonTitle: celestialSeasonTitle,
};
