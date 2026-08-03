'use strict';

const { bracketOf } = require('../config/ranked');

function firstRow(result) {
  return result?.rows?.[0] || {};
}

function characterRecords(character, raidResult, rankedResult) {
  const raid = firstRow(raidResult);
  const ranked = firstRow(rankedResult);
  const duels = Number(ranked.total) || 0;
  const wins = Number(ranked.wins) || 0;
  const globalRank = ranked.global_rank == null || !Number.isFinite(Number(ranked.global_rank))
    ? '-'
    : Number(ranked.global_rank);

  return [
    Number(character.highest_raid_streak) || 0,
    Number(raid.current) || 0,
    Number(character.highest_rank_streak) || 0,
    globalRank,
    duels === 0 ? '-' : `${Math.round(100 * wins / duels)}%`,
    bracketOf(character.pvp_rating).name,
  ];
}

module.exports = { characterRecords };
