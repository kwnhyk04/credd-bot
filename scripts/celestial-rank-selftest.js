'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  BRACKETS,
  bracketOf,
  bracketIndex,
  matchRangeWide,
} = require('../src/config/ranked');
const {
  CELESTIAL_SEASON_TITLES,
  celestialSeasonTitle,
} = require('../src/config/titles');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function main() {
  assert.deepEqual(BRACKETS.map((bracket) => bracket.name), [
    'Mortal', 'Champion', 'Demigod', 'Ascendant', 'Divine', 'Celestial',
  ]);
  assert.deepEqual(BRACKETS.map(({ floor, ceil }) => [floor, ceil]), [
    [0, 999], [1000, 2499], [2500, 4999], [5000, 9999],
    [10000, 19999], [20000, Infinity],
  ]);
  assert.equal(bracketOf(19_999).name, 'Divine');
  assert.equal(bracketOf(20_000).name, 'Celestial');
  assert.equal(bracketOf(20_001).name, 'Celestial');
  assert.equal(bracketOf(1_000_000_000).name, 'Celestial');
  assert.equal(bracketIndex('Celestial'), 5);
  assert.deepEqual(matchRangeWide(20_000), { lo: 10_000, hi: 1_000_000_000 });

  for (let rating = 0; rating <= 25_000; rating++) {
    const matches = BRACKETS.filter((bracket) => rating >= bracket.floor && rating <= bracket.ceil);
    assert.equal(matches.length, 1, `rating ${rating} must match exactly one bracket`);
    assert.equal(bracketOf(rating), matches[0]);
  }
  for (let index = 1; index < BRACKETS.length; index++) {
    assert.equal(BRACKETS[index - 1].ceil + 1, BRACKETS[index].floor);
  }

  assert.equal(CELESTIAL_SEASON_TITLES.length, 6);
  assert.equal(celestialSeasonTitle(1), CELESTIAL_SEASON_TITLES[0]);
  assert.equal(celestialSeasonTitle(7), CELESTIAL_SEASON_TITLES[0]);

  const season = source('src/engine/seasonEngine.js');
  assert(season.includes("bracket === 'Celestial'"));
  assert.equal(season.includes("bracket === 'Divine'"), false);
  assert(season.includes('ensureSeasonTitle(client, seasonId, seasonName, bracket)'));

  const ranked = source('src/commands/rpg/ranked.js');
  const leaderboard = source('src/commands/rpg/leaderboard.js');
  assert(ranked.includes("require('../../config/ranked')"));
  assert(ranked.includes('bracketIndex(myBracket.name) + 1'));
  assert(leaderboard.includes('bracketOf(v).name'));

  const dev = source('src/commands/rpg/dev.js');
  assert(dev.includes("UPDATE user_character SET pvp_rating = $1"));
  assert.equal(/Math\.min\(\s*rating\s*,\s*19999/.test(dev), false);

  const preflight = source('scripts/production-preflight.js');
  assert(preflight.includes("ranked_reward: ['bracket'"));
  assert.equal(/BRACKETS\.length\s*===?\s*5|Mortal.*Champion.*Demigod.*Ascendant.*Divine(?!.*Celestial)/s.test(preflight), false);

  console.log('CELESTIAL RANK SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
