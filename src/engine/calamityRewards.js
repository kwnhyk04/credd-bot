'use strict';

const { randomInt } = require('node:crypto');

const ROLL_SCALE = 1_000_000;
const SUPREME_CHEST_REWARD = Object.freeze({
  column: 'supreme_chest',
  qty: 1,
  label: 'Supreme Chest',
});

function clampChance(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function validDamageRows(rows) {
  return (rows || [])
    .map((row) => ({
      userId: String(row.userId ?? row.discord_id ?? ''),
      damage: Number(row.damage ?? row.total_damage),
    }))
    .filter((row) => row.userId && Number.isFinite(row.damage) && row.damage > 0);
}

function totalDamage(rows) {
  return rows.reduce((total, row) => total + row.damage, 0);
}

/**
 * Roll one independent Supreme Chest chance for every valid Calamity participant.
 * The default randomInteger is node:crypto.randomInt; injection is only for tests.
 */
function rollCalamitySupremeRewards(rows, {
  randomInteger = randomInt,
  logger = console.info,
} = {}) {
  const participants = validDamageRows(rows);
  const totalEligibleDamage = totalDamage(participants);
  if (!Number.isFinite(totalEligibleDamage) || totalEligibleDamage <= 0) {
    logger('[boss] calamity supreme rolls skipped', {
      reason: 'total eligible damage is zero',
      participantCount: 0,
    });
    return {
      participants: [],
      totalEligibleDamage: 0,
      rolls: [],
      winnerIds: [],
    };
  }

  const rolls = participants.map(({ userId, damage }) => {
    const rawChance = damage / totalEligibleDamage;
    const bonusChance = clampChance(rawChance);
    const winningThreshold = Math.floor(bonusChance * ROLL_SCALE);
    const roll = randomInteger(0, ROLL_SCALE);
    const wonSupremeChest = roll < winningThreshold;
    const result = {
      userId,
      playerDamage: damage,
      totalEligibleDamage,
      rawDamageRatio: rawChance,
      calculatedThreshold: winningThreshold,
      cryptoGeneratedRoll: roll,
      success: wonSupremeChest,
      supremeChestGranted: wonSupremeChest ? 1 : 0,
    };
    logger('[boss] calamity supreme roll', result);
    return result;
  });

  return {
    participants,
    totalEligibleDamage,
    rolls,
    winnerIds: rolls.filter((roll) => roll.success).map((roll) => roll.userId),
  };
}

module.exports = {
  ROLL_SCALE,
  SUPREME_CHEST_REWARD,
  clampChance,
  validDamageRows,
  totalDamage,
  rollCalamitySupremeRewards,
};
