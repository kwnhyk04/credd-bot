'use strict';

/**
 * awardCombatExp — shared Combat-EXP grant (Master §17 curve, Phase 7 Scope 4).
 *
 * The curve lives in config/combatExp.js (EXP_REQUIRED, verified line-by-line
 * against §17 — incl. the authored 40→41 = 800k reset and cap 50); this util
 * adds the DB persistence layer on top: lock → apply → write. Combat EXP is
 * completely separate from Reputation EXP (awardReputation / summonEngine are
 * untouched).
 *
 * Both helpers REQUIRE an open-transaction client: they lock user_character
 * rows FOR UPDATE and persist level/exp, so the grant commits or rolls back
 * atomically with the caller's other writes (raid rewards, boss distribution).
 * Lock-order convention (Phase 5): users_bag BEFORE user_character — call
 * these only after any users_bag locks in the same transaction.
 */

const { applyCombatExp } = require('../config/combatExp');
const { scaleExpForMobLevel } = require('../config/expScaling');
const { grantCombatLevelRewards, grantCombatLevelRewardsMany } = require('./grantLevelRewards');

/**
 * [Progression v2] The gain applyCombatExp will actually consume. Kept in one place so
 * the value written to lifetime_exp can never drift from the value applied to
 * level/exp — that equality IS the invariant the whole design rests on.
 */
function appliedGain(gain) {
  return Math.max(0, Number(gain) || 0);
}

/**
 * Grant `gain` combat EXP to one player (raid path).
 * On level-up, also credits the per-level rewards (spec S1) exactly once in
 * the same transaction; `rewards` is `{ credux, chests, levels }` or null.
 * @returns {{ levelsGained, newLevel, newExp, leveledUp, previousLevel, rewards }}
 */
async function awardCombatExp(client, discordId, gain) {
  const res = await client.query(
    'SELECT combat_level, combat_exp FROM user_character WHERE discord_id = $1 FOR UPDATE',
    [discordId]
  );
  if (res.rows.length === 0) {
    throw new Error(`awardCombatExp: no character row for ${discordId}`);
  }
  const { combat_level: level, combat_exp: exp } = res.rows[0];
  const next = applyCombatExp(level, exp, gain);
  // lifetime_exp is the v2 source of truth; level/exp are its derived cache. Increment
  // by the same clamped value applyCombatExp consumed so the two can never diverge.
  await client.query(
    `UPDATE user_character
        SET combat_level = $2, combat_exp = $3, lifetime_exp = lifetime_exp + $4
      WHERE discord_id = $1`,
    [discordId, next.level, next.exp, appliedGain(gain)]
  );
  const rewards = next.level > level
    ? await grantCombatLevelRewards(client, discordId, level, next.level)
    : null;
  return {
    levelsGained: next.level - level,
    newLevel: next.level,
    newExp: next.exp,
    leveledUp: next.leveledUp,
    previousLevel: level,
    rewards,
  };
}

/**
 * Bulk grant — boss participation (same `gain` for every player). Locks all
 * rows in sorted-id order (deadlock-safe vs. concurrent raid commits), applies
 * the curve in JS, persists with ONE set-based UPDATE.
 * @returns {Map<string, { levelsGained, newLevel, newExp, leveledUp, previousLevel }>}
 */
async function awardCombatExpMany(client, discordIds, gain, { scaleByParticipantLevel = false } = {}) {
  const out = new Map();
  if (!discordIds || discordIds.length === 0) return out;
  const ids = [...discordIds].sort();
  const res = await client.query(
    `SELECT discord_id, combat_level, combat_exp FROM user_character
      WHERE discord_id = ANY($1) ORDER BY discord_id FOR UPDATE`,
    [ids]
  );
  const updIds = [], updLvls = [], updExps = [], updGains = [];
  for (const r of res.rows) {
    // [Progression v2] Boss EXP scales off each ATTACKER'S OWN level, never the boss's.
    // Boss level is AVG(combat_level) of active players, so scaling off it would let a
    // level 20 player in a level 60 fight out-earn levels 1-20 combined. The per-row
    // loop already existed, so this needs no change to the set-based UPDATE's shape.
    const rowGain = appliedGain(
      scaleByParticipantLevel ? scaleExpForMobLevel(gain, r.combat_level) : gain
    );
    const next = applyCombatExp(r.combat_level, r.combat_exp, rowGain);
    updIds.push(r.discord_id);
    updLvls.push(next.level);
    updExps.push(next.exp);
    updGains.push(rowGain);
    out.set(r.discord_id, {
      levelsGained: next.level - r.combat_level,
      newLevel: next.level,
      newExp: next.exp,
      leveledUp: next.leveledUp,
      previousLevel: r.combat_level,
      expGained: rowGain,
    });
  }
  if (updIds.length > 0) {
    await client.query(
      `UPDATE user_character uc
          SET combat_level = u.lvl, combat_exp = u.exp,
              lifetime_exp = uc.lifetime_exp + u.gain
         FROM unnest($1::varchar[], $2::smallint[], $3::bigint[], $4::bigint[])
              AS u(discord_id, lvl, exp, gain)
        WHERE uc.discord_id = u.discord_id`,
      [updIds, updLvls, updExps, updGains]
    );
  }
  // Per-level rewards for everyone who leveled (set-based, same transaction).
  const levelUps = new Map();
  for (const [discordId, info] of out) {
    if (info.levelsGained > 0) {
      levelUps.set(discordId, { previousLevel: info.previousLevel, newLevel: info.newLevel });
    }
  }
  if (levelUps.size > 0) {
    const rewardsById = await grantCombatLevelRewardsMany(client, levelUps);
    for (const [discordId, rewards] of rewardsById) {
      const info = out.get(discordId);
      if (info) info.rewards = rewards;
    }
  }
  return out;
}

module.exports = { awardCombatExp, awardCombatExpMany };
