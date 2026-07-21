'use strict';

const pool = require('../db/pool');
const { REP_DAILY_CAP } = require('../config/gachaRates');
const { BELIEVER_EXP_PER_LEVEL } = require('../config/believerProgression');
const { believerTitlesFor } = require('../config/titles');
const { grantTitles } = require('./titleGrant');
const { grantBelieverLevelRewards } = require('./grantLevelRewards');
const { formatBelieverLevelUpNotice } = require('../config/levelRewards');

const BELIEVER_EXP_PER_COMMAND = 3;
const COMMANDS_WITH_BUILT_IN_BELIEVER_EXP = new Set(['summon']);
const RELIC_OPEN_ALIASES = new Set(['sr', 'supr']);

function shouldAwardCommandBelieverExp(commandKey, args = []) {
  const command = String(commandKey || '').toLowerCase();
  if (COMMANDS_WITH_BUILT_IN_BELIEVER_EXP.has(command)) return false;
  if (command === 'open' && RELIC_OPEN_ALIASES.has(String(args[0] || '').toLowerCase())) return false;
  return true;
}

/**
 * Grant believer EXP (daily-capped) and, on level-up, the per-level rewards
 * (Genesis spec S2) exactly once.
 *
 * Runs on EVERY command (3 exp), so the common case must stay cheap:
 *  - fast path: an unlocked probe shows no level-up is possible → identical
 *    flow to before (char lock only, no bag lock, no reward query).
 *  - slow path: level-up possible → take the users_bag lock BEFORE the
 *    user_character lock (project lock order: bag → character) so the reward
 *    credit inside the same transaction cannot invert lock order.
 *  - stale-probe race: if a concurrent grant made a level-up appear after the
 *    probe, retry once with the bag lock held. Rewards and the exp write
 *    commit or roll back together — a level is never marked rewarded without
 *    being paid.
 *
 * @returns {{ awarded: number, levelUp: null | { previousLevel, newLevel, rewards } }}
 */
async function awardBelieverExp(discordId, amount = BELIEVER_EXP_PER_COMMAND) {
  const gain = Number(amount);
  if (!discordId || !Number.isFinite(gain) || gain <= 0) return { awarded: 0, levelUp: null };

  // Unlocked probe: `gain` is an upper bound on what can be awarded (the daily
  // cap only lowers it), so exp + gain < threshold ⇒ no level-up possible.
  const probe = await pool.query(
    'SELECT believer_exp FROM user_character WHERE discord_id = $1',
    [discordId]
  );
  if (probe.rows.length === 0) return { awarded: 0, levelUp: null };
  let lockBag = Number(probe.rows[0].believer_exp) + gain >= BELIEVER_EXP_PER_LEVEL;

  const client = await pool.connect();
  try {
    // Attempt 1 honors the probe; attempt 2 (stale-probe race) forces the bag lock.
    for (let attempt = 0; attempt < 2; attempt++) {
      await client.query('BEGIN');
      if (lockBag) {
        await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [discordId]);
      }
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
        return { awarded: 0, levelUp: null };
      }

      const char = rows[0];
      const today = char.pht_today;
      const resetDate = char.reputation_exp_reset_date;
      const sameDay = resetDate != null && resetDate.getTime() === today.getTime();
      const todaySoFar = sameDay ? Number(char.reputation_exp_today) : 0;
      const awarded = Math.min(gain, Math.max(0, REP_DAILY_CAP - todaySoFar));

      const startLevel = Number(char.believer_level);
      let level = startLevel;
      let exp = Number(char.believer_exp) + awarded;
      while (exp >= BELIEVER_EXP_PER_LEVEL) {
        exp -= BELIEVER_EXP_PER_LEVEL;
        level += 1;
      }

      if (level > startLevel && !lockBag) {
        // Probe was stale (concurrent grant landed in between). Restart with
        // the bag lock first so the reward credit keeps bag → character order.
        await client.query('ROLLBACK');
        lockBag = true;
        continue;
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

      let levelUp = null;
      if (level > startLevel) {
        const rewards = await grantBelieverLevelRewards(client, discordId, startLevel, level);
        levelUp = { previousLevel: startLevel, newLevel: level, rewards };
      }

      await grantTitles(client, discordId, believerTitlesFor(level));
      await client.query('COMMIT');
      return { awarded, levelUp };
    }
    return { awarded: 0, levelUp: null }; // unreachable (attempt 2 always returns)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function awardCommandBelieverExp(discordId, commandKey = '', args = []) {
  if (!shouldAwardCommandBelieverExp(commandKey, args)) return { awarded: 0, levelUp: null };
  try {
    return await awardBelieverExp(discordId, BELIEVER_EXP_PER_COMMAND);
  } catch (err) {
    console.error(`[believerExp] command grant failed (${commandKey || 'unknown'}):`, err.message);
    return { awarded: 0, levelUp: null };
  }
}

/**
 * Fire-and-forget believer level-up notice (spec S3): previous level, new
 * level, total Credux and chests grouped by type. Display-only — a failed
 * send never affects the committed grant.
 */
function notifyBelieverLevelUp(channel, discordId, result) {
  const notice = formatBelieverLevelUpNotice(result?.levelUp);
  if (!notice || !channel || typeof channel.send !== 'function') return;
  channel.send({
    content: `<@${discordId}>\n${notice}`,
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

module.exports = {
  BELIEVER_EXP_PER_COMMAND,
  awardBelieverExp,
  awardCommandBelieverExp,
  shouldAwardCommandBelieverExp,
  notifyBelieverLevelUp,
};
