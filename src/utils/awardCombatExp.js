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

/**
 * Grant `gain` combat EXP to one player (raid path).
 * @returns {{ levelsGained, newLevel, newExp, leveledUp, previousLevel }}
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
  await client.query(
    'UPDATE user_character SET combat_level = $2, combat_exp = $3 WHERE discord_id = $1',
    [discordId, next.level, next.exp]
  );
  return {
    levelsGained: next.level - level,
    newLevel: next.level,
    newExp: next.exp,
    leveledUp: next.leveledUp,
    previousLevel: level,
  };
}

/**
 * Bulk grant — boss participation (same `gain` for every player). Locks all
 * rows in sorted-id order (deadlock-safe vs. concurrent raid commits), applies
 * the curve in JS, persists with ONE set-based UPDATE.
 * @returns {Map<string, { levelsGained, newLevel, newExp, leveledUp, previousLevel }>}
 */
async function awardCombatExpMany(client, discordIds, gain) {
  const out = new Map();
  if (!discordIds || discordIds.length === 0) return out;
  const ids = [...discordIds].sort();
  const res = await client.query(
    `SELECT discord_id, combat_level, combat_exp FROM user_character
      WHERE discord_id = ANY($1) ORDER BY discord_id FOR UPDATE`,
    [ids]
  );
  const updIds = [], updLvls = [], updExps = [];
  for (const r of res.rows) {
    const next = applyCombatExp(r.combat_level, r.combat_exp, gain);
    updIds.push(r.discord_id);
    updLvls.push(next.level);
    updExps.push(next.exp);
    out.set(r.discord_id, {
      levelsGained: next.level - r.combat_level,
      newLevel: next.level,
      newExp: next.exp,
      leveledUp: next.leveledUp,
      previousLevel: r.combat_level,
    });
  }
  if (updIds.length > 0) {
    await client.query(
      `UPDATE user_character uc
          SET combat_level = u.lvl, combat_exp = u.exp
         FROM unnest($1::varchar[], $2::smallint[], $3::bigint[]) AS u(discord_id, lvl, exp)
        WHERE uc.discord_id = u.discord_id`,
      [updIds, updLvls, updExps]
    );
  }
  return out;
}

module.exports = { awardCombatExp, awardCombatExpMany };
