'use strict';

const pool = require('../db/pool');
const { REP_DAILY_CAP } = require('../config/gachaRates');
const { BELIEVER_EXP_PER_LEVEL } = require('../config/believerProgression');
const { believerTitlesFor } = require('../config/titles');
const { grantTitles } = require('./titleGrant');

const BELIEVER_EXP_PER_COMMAND = 3;
const COMMANDS_WITH_BUILT_IN_BELIEVER_EXP = new Set(['summon']);
const RELIC_OPEN_ALIASES = new Set(['sr', 'supr']);

function shouldAwardCommandBelieverExp(commandKey, args = []) {
  const command = String(commandKey || '').toLowerCase();
  if (COMMANDS_WITH_BUILT_IN_BELIEVER_EXP.has(command)) return false;
  if (command === 'open' && RELIC_OPEN_ALIASES.has(String(args[0] || '').toLowerCase())) return false;
  return true;
}

async function awardBelieverExp(discordId, amount = BELIEVER_EXP_PER_COMMAND) {
  const gain = Number(amount);
  if (!discordId || !Number.isFinite(gain) || gain <= 0) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT believer_level, believer_exp,
              reputation_exp_today, reputation_exp_reset_date,
              (NOW() AT TIME ZONE 'Asia/Manila')::date AS pht_today
         FROM user_character
        WHERE discord_id = $1
        FOR UPDATE`,
      [discordId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return 0;
    }

    const char = rows[0];
    const today = char.pht_today;
    const resetDate = char.reputation_exp_reset_date;
    const sameDay = resetDate != null && resetDate.getTime() === today.getTime();
    const todaySoFar = sameDay ? Number(char.reputation_exp_today) : 0;
    const awarded = Math.min(gain, Math.max(0, REP_DAILY_CAP - todaySoFar));

    let level = Number(char.believer_level);
    let exp = Number(char.believer_exp) + awarded;
    while (exp >= BELIEVER_EXP_PER_LEVEL) {
      exp -= BELIEVER_EXP_PER_LEVEL;
      level += 1;
    }

    await client.query(
      `UPDATE user_character
          SET believer_level = $2,
              believer_exp = $3,
              reputation_exp_today = $4,
              reputation_exp_reset_date = $5
        WHERE discord_id = $1`,
      [discordId, level, exp, todaySoFar + awarded, today]
    );

    await grantTitles(client, discordId, believerTitlesFor(level));
    await client.query('COMMIT');
    return awarded;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function awardCommandBelieverExp(discordId, commandKey = '', args = []) {
  if (!shouldAwardCommandBelieverExp(commandKey, args)) return 0;
  try {
    return await awardBelieverExp(discordId, BELIEVER_EXP_PER_COMMAND);
  } catch (err) {
    console.error(`[believerExp] command grant failed (${commandKey || 'unknown'}):`, err.message);
    return 0;
  }
}

module.exports = {
  BELIEVER_EXP_PER_COMMAND,
  awardBelieverExp,
  awardCommandBelieverExp,
  shouldAwardCommandBelieverExp,
};
