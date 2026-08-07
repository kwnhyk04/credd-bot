'use strict';

/**
 * BOSS SYSTEM — Master §16 (persistent active bosses, boss art) + Phase 7 prompt.
 *
 * Facade. The implementation lives in four focused modules under ./boss/,
 * layered strictly downward so no cycle can form:
 *
 *   bossProgress  spawn, reward distribution, attacks, scheduler tick
 *   bossMessages  live-message lifecycle, announce channel, CV2 payload
 *   bossRuntime   in-memory Maps (live messages, log cache, spawn memory)
 *   bossRender    boss art, banner cache, lore, status card
 *
 * This file re-exports the same names it always has, so index.js,
 * interactionHandler, bossScheduler, the boss/dev commands, and the selftests
 * are unaffected by the split.
 */

const {
  tickGuild, processQueuedCalamity, spawnBoss, distributeRewards,
  handleAttack, handleLog,
} = require('./boss/bossProgress');
const {
  fetchBossView, buildBossMessage, repointLiveMessage, refreshLiveMessage,
  postOfficialRedirect, postFreshLiveMessage, redirectChannelIssue,
} = require('./boss/bossMessages');
const { clearBossRuntimeForGuild, getBossMemoryStats } = require('./boss/bossRuntime');
const { bossStatusCardHeight } = require('./boss/bossRender');

module.exports = {
  tickGuild,
  processQueuedCalamity,
  spawnBoss,
  distributeRewards,
  handleAttack,
  handleLog,
  fetchBossView,
  buildBossMessage,
  repointLiveMessage,
  refreshLiveMessage,
  postOfficialRedirect,
  postFreshLiveMessage,
  redirectChannelIssue,
  clearBossRuntimeForGuild,
  getBossMemoryStats,
  bossStatusCardHeight,
};
