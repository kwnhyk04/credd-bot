'use strict';

const { randomInt } = require('node:crypto');
const { BAGS } = require('../config/runes');

const ROLL_SCALE = 1_000_000;
const SUPREME_CHEST_REWARD = Object.freeze({
  column: 'supreme_chest',
  qty: 1,
  label: 'Supreme Chest',
  emojiName: 'supreme_chest',
});
const DIVINE_BAG_REWARD = Object.freeze({
  column: BAGS.divine.column,
  qty: 1,
  label: BAGS.divine.name,
  emojiName: BAGS.divine.emojiName,
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
 * Roll independent Supreme Chest and Divine Bag chances for every valid Calamity
 * participant. Both use the same unrounded damage-share threshold and the same
 * node:crypto.randomInt mechanism. Injection is only for tests.
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
      supremeWinnerIds: [],
      divineWinnerIds: [],
    };
  }

  const rolls = participants.map(({ userId, damage }) => {
    const rawChance = damage / totalEligibleDamage;
    const bonusChance = clampChance(rawChance);
    const winningThreshold = Math.floor(bonusChance * ROLL_SCALE);
    const supremeRoll = randomInteger(0, ROLL_SCALE);
    const divineRoll = randomInteger(0, ROLL_SCALE);
    const wonSupremeChest = supremeRoll < winningThreshold;
    const wonDivineBag = divineRoll < winningThreshold;
    const shared = {
      userId,
      playerDamage: damage,
      totalEligibleDamage,
      rawDamageRatio: rawChance,
      calculatedThreshold: winningThreshold,
    };
    const result = {
      ...shared,
      cryptoGeneratedRoll: supremeRoll,
      supremeCryptoGeneratedRoll: supremeRoll,
      divineCryptoGeneratedRoll: divineRoll,
      success: wonSupremeChest,
      supremeSuccess: wonSupremeChest,
      divineSuccess: wonDivineBag,
      supremeChestGranted: wonSupremeChest ? 1 : 0,
      divineBagGranted: wonDivineBag ? 1 : 0,
    };
    // Preserve the established Supreme log event/fields, then add a parallel
    // Divine event driven by the second independent secure draw.
    logger('[boss] calamity supreme roll', {
      ...shared,
      cryptoGeneratedRoll: supremeRoll,
      success: wonSupremeChest,
      supremeChestGranted: wonSupremeChest ? 1 : 0,
    });
    logger('[boss] calamity divine roll', {
      ...shared,
      cryptoGeneratedRoll: divineRoll,
      success: wonDivineBag,
      divineBagGranted: wonDivineBag ? 1 : 0,
    });
    return result;
  });

  const supremeWinnerIds = rolls
    .filter((roll) => roll.supremeSuccess)
    .map((roll) => roll.userId);
  const divineWinnerIds = rolls
    .filter((roll) => roll.divineSuccess)
    .map((roll) => roll.userId);

  return {
    participants,
    totalEligibleDamage,
    rolls,
    // Keep winnerIds as the established Supreme-Chest result for existing callers.
    winnerIds: supremeWinnerIds,
    supremeWinnerIds,
    divineWinnerIds,
  };
}

/** Actual successful Calamity bonus rewards, omitting every failed roll. */
function grantedCalamityBonusRewards({ supremeWinnerIds = [], divineWinnerIds = [] } = {}) {
  const granted = [];
  if (supremeWinnerIds.length > 0) {
    granted.push({ ...SUPREME_CHEST_REWARD, winnerCount: supremeWinnerIds.length });
  }
  if (divineWinnerIds.length > 0) {
    granted.push({ ...DIVINE_BAG_REWARD, winnerCount: divineWinnerIds.length });
  }
  return granted;
}

module.exports = {
  ROLL_SCALE,
  SUPREME_CHEST_REWARD,
  DIVINE_BAG_REWARD,
  clampChance,
  validDamageRows,
  totalDamage,
  rollCalamitySupremeRewards,
  grantedCalamityBonusRewards,
};
