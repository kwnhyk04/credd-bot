'use strict';

/**
 * levelRewards — Genesis update reward tables for Combat and Believer level-ups
 * (spec sections 1-2). Single source of truth: the live grant path, the
 * retroactive compensation script, and every display all read these tables.
 *
 * Chest keys are users_bag COLUMN NAMES so crediting is a direct column add.
 * Level 1 is the starting level and is never rewarded (owner decision) — both
 * live grants and compensation begin at level 2. Levels above 50 grant nothing.
 */

const MIN_REWARD_LEVEL = 2;
const MAX_REWARD_LEVEL = 50;

const COMBAT_REWARD_BRACKETS = Object.freeze([
  Object.freeze({ min: 1,  max: 10, credux: 100_000,   chests: Object.freeze({ gold_chest: 1 }) }),
  Object.freeze({ min: 11, max: 20, credux: 250_000,   chests: Object.freeze({ boss_treasure_chest: 1 }) }),
  Object.freeze({ min: 21, max: 30, credux: 500_000,   chests: Object.freeze({ boss_treasure_chest: 2 }) }),
  Object.freeze({ min: 31, max: 40, credux: 1_000_000, chests: Object.freeze({ boss_treasure_chest: 3 }) }),
  Object.freeze({ min: 41, max: 50, credux: 5_000_000, chests: Object.freeze({ boss_golden_chest: 1 }) }),
]);

const BELIEVER_REWARD_BRACKETS = Object.freeze([
  Object.freeze({ min: 1,  max: 10, credux: 250_000,   chests: Object.freeze({ gold_chest: 5 }) }),
  Object.freeze({ min: 11, max: 20, credux: 500_000,   chests: Object.freeze({ boss_treasure_chest: 5 }) }),
  Object.freeze({ min: 21, max: 30, credux: 1_000_000, chests: Object.freeze({ boss_treasure_chest: 10 }) }),
  Object.freeze({ min: 31, max: 50, credux: 1_000_000, chests: Object.freeze({ boss_golden_chest: 5 }) }),
]);

// The only chest columns level rewards may ever credit (whitelist used to
// build the users_bag UPDATE — never interpolate anything else).
const REWARD_CHEST_COLUMNS = Object.freeze(['gold_chest', 'boss_treasure_chest', 'boss_golden_chest']);

const CHEST_LABELS = Object.freeze({
  gold_chest: 'Gold Chest',
  boss_treasure_chest: 'Boss Treasure Chest',
  boss_golden_chest: 'Boss Golden Chest',
});

function rewardForLevel(brackets, level) {
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl < MIN_REWARD_LEVEL || lvl > MAX_REWARD_LEVEL) return null;
  const bracket = brackets.find((b) => lvl >= b.min && lvl <= b.max);
  return bracket ? { credux: bracket.credux, chests: bracket.chests } : null;
}

/** Reward for one Combat Level (null when the level grants nothing). */
function combatRewardForLevel(level) {
  return rewardForLevel(COMBAT_REWARD_BRACKETS, level);
}

/** Reward for one Believer Level (null when the level grants nothing). */
function believerRewardForLevel(level) {
  return rewardForLevel(BELIEVER_REWARD_BRACKETS, level);
}

/**
 * Aggregate rewards for a set of individual levels (per-level granting with
 * bracket crossing — 19→22 sums the level 20, 21 and 22 rewards separately).
 * @param {'combat'|'believer'} kind
 * @param {number[]} levels
 * @returns {{ credux: number, chests: Object<string, number> }}
 */
function sumLevelRewards(kind, levels) {
  const forLevel = kind === 'believer' ? believerRewardForLevel : combatRewardForLevel;
  const total = { credux: 0, chests: {} };
  for (const level of levels || []) {
    const r = forLevel(level);
    if (!r) continue;
    total.credux += r.credux;
    for (const [col, qty] of Object.entries(r.chests)) {
      total.chests[col] = (total.chests[col] || 0) + qty;
    }
  }
  return total;
}

/**
 * One-line reward summary for level-up notices, e.g.
 * "+350,000 Credux · +1 Gold Chest · +1 Boss Treasure Chest".
 * Returns '' when nothing was granted.
 */
function formatLevelRewardLine(rewards) {
  if (!rewards) return '';
  const parts = [];
  if (rewards.credux > 0) parts.push(`+${rewards.credux.toLocaleString('en-US')} Credux`);
  for (const col of REWARD_CHEST_COLUMNS) {
    const qty = rewards.chests?.[col];
    if (qty > 0) parts.push(`+${qty} ${CHEST_LABELS[col]}${qty > 1 ? 's' : ''}`);
  }
  return parts.join(' · ');
}

/**
 * Believer level-up notice (command exp + summon reputation paths), e.g.
 * "📿 **Believer Level 12 → 13!**\n🎁 Level Rewards: +500,000 Credux · +5 Boss Treasure Chests"
 * Returns '' when levelUp is null.
 */
function formatBelieverLevelUpNotice(levelUp) {
  if (!levelUp) return '';
  const rewardsText = formatLevelRewardLine(levelUp.rewards);
  return (
    `📿 **Believer Level ${levelUp.previousLevel} → ${levelUp.newLevel}!**` +
    (rewardsText ? `\n🎁 Level Rewards: ${rewardsText}` : '')
  );
}

module.exports = {
  MIN_REWARD_LEVEL,
  MAX_REWARD_LEVEL,
  COMBAT_REWARD_BRACKETS,
  BELIEVER_REWARD_BRACKETS,
  REWARD_CHEST_COLUMNS,
  CHEST_LABELS,
  combatRewardForLevel,
  believerRewardForLevel,
  sumLevelRewards,
  formatLevelRewardLine,
  formatBelieverLevelUpNotice,
};
