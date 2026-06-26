'use strict';

/**
 * `crd ranked` — Elo-rated PvP vs an auto-matched real-user snapshot (v5 Phase 4).
 * `crd ranked claim` — weekly bracket reward (>=5 ranked games this PHT week).
 *
 * Matchmaking pulls a random eligible opponent within adjacent brackets and runs a
 * level-normalized duel-mode battle. ONLY the challenger's pvp_rating changes — the
 * snapshot opponent is offline and untouched (Blueprint §4.3A, decision: challenger
 * rating only). Demotion shield holds a player at the bracket floor for one loss.
 */

const { ContainerBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const pool = require('../../db/pool');
const { resolveBattle } = require('../../engine/battleEngine');
const { buildPlayerFighter } = require('../../engine/statAssembly');
const { runBattle } = require('../../engine/battleRender');
const { resolveSkin } = require('../../engine/skinResolver');
const {
  bracketOf, bracketFloor, matchRange, pointsFor, phtWeek, WEEKLY_MIN_GAMES,
} = require('../../config/ranked');

const GOLD = 0xf0b232;
const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

// item key (ranked_reward payload) → users_bag column
const ITEM_COLUMN = {
  silver_chest: 'silver_chest',
  gold_chest: 'gold_chest',
  boss_treasure: 'boss_treasure_chest',
  boss_golden: 'boss_golden_chest',
  supreme_chest: 'supreme_chest',
  sacred_relic: 'sacred_relics',
  supreme_relic: 'supreme_relics',
};

/** Apply a ranked result to the challenger's rating with demotion-shield logic. */
function applyRating(ratingBefore, shieldBefore, delta) {
  let rating = ratingBefore + delta;
  let shield = shieldBefore;
  if (delta < 0) {
    const floor = bracketFloor(bracketOf(ratingBefore).name);
    if (rating < floor) {
      if (shield) { rating = floor; shield = false; }      // protected: hold at floor
      else { shield = true; }                              // demote, fresh shield in new bracket
    }
  } else if (delta > 0) {
    if (bracketOf(rating).name !== bracketOf(ratingBefore).name) shield = true; // fresh shield on promote
  }
  if (rating < 0) rating = 0;
  return { rating, shield };
}

// ── crd ranked — find a match and fight ────────────────────────────────────
async function fight(message) {
  const me = message.author.id;
  const selfRes = await pool.query(
    'SELECT pvp_rating, pvp_demotion_shield, pvp_peak FROM user_character WHERE discord_id = $1',
    [me]
  );
  if (selfRes.rows.length === 0) return reply(message, 'No character found.');
  const self = selfRes.rows[0];
  const rating = self.pvp_rating;
  const { lo, hi } = matchRange(rating);

  const oppRes = await pool.query(
    `SELECT uc.discord_id, u.username, uc.pvp_rating
       FROM user_character uc JOIN users u ON u.discord_id = uc.discord_id
      WHERE uc.pvp_rating BETWEEN $1 AND $2 AND uc.discord_id <> $3
      ORDER BY random() LIMIT 1`,
    [lo, hi, me]
  );
  if (oppRes.rows.length === 0) {
    return reply(message, '⚔️ No eligible opponent in your bracket range right now — try again later.');
  }
  const opp = oppRes.rows[0];
  const oppRating = opp.pvp_rating;

  // Ranked fights at TRUE levels/stats/equipment — no normalization (build + level both matter).
  const [p1, p2] = await Promise.all([
    buildPlayerFighter(pool, me),
    buildPlayerFighter(pool, opp.discord_id),
  ]);
  if (!p1 || !p2) return reply(message, 'Ranked cancelled — a combatant has no character.');

  const sim = resolveBattle(p1, p2, { mode: 'duel', seed: Date.now() >>> 0 });
  const won = sim.winner === 'a';
  const delta = pointsFor(rating, oppRating, won);
  const { rating: newRating, shield } = applyRating(rating, self.pvp_demotion_shield, delta);
  const newPeak = Math.max(self.pvp_peak, newRating);

  await pool.query(
    `UPDATE user_character SET pvp_rating = $2, pvp_demotion_shield = $3, pvp_peak = $4 WHERE discord_id = $1`,
    [me, newRating, shield, newPeak]
  );
  await pool.query(
    `INSERT INTO ranked_logs (player_id, opponent_id, result, rating_before, rating_after)
     VALUES ($1, $2, $3, $4, $5)`,
    [me, opp.discord_id, won ? 'win' : 'loss', rating, newRating]
  );

  const sign = delta >= 0 ? '+' : '';
  const ratingLine = `${won ? '🏆 Victory' : '💀 Defeat'} vs **${opp.username}** · Rating ${sign}${delta} → **${newRating}** (${bracketOf(newRating).name})`;

  let battleSkinPath = null;
  let resultSkinPath = null;
  try {
    battleSkinPath = (await resolveSkin(pool, me, 'battle')).path;
    const variant = won ? 'victory' : 'defeated';
    resultSkinPath = (await resolveSkin(pool, me, 'battle_result', { variant })).path;
  } catch (err) {
    console.warn('[ranked] skin resolution:', err.message);
  }
  await runBattle(message.channel, {
    mode: 'duel', sim, notices: [ratingLine], battleSkinPath, resultSkinPath,
  });
}

// ── crd ranked claim — weekly bracket reward ───────────────────────────────
async function claim(message) {
  const me = message.author.id;
  const week = phtWeek();

  const charRes = await pool.query(
    'SELECT pvp_rating, last_weekly_claim_week FROM user_character WHERE discord_id = $1', [me]
  );
  if (charRes.rows.length === 0) return reply(message, 'No character found.');
  const { pvp_rating, last_weekly_claim_week } = charRes.rows[0];

  if (last_weekly_claim_week === week) {
    return reply(message, '✅ You already claimed this week\'s ranked reward. Come back next week.');
  }

  const gamesRes = await pool.query(
    `SELECT count(*)::int AS n FROM ranked_logs
      WHERE player_id = $1 AND timestamp >= (NOW() AT TIME ZONE 'Asia/Manila')::date - INTERVAL '7 days'`,
    [me]
  );
  const games = gamesRes.rows[0].n;
  if (games < WEEKLY_MIN_GAMES) {
    return reply(message, `⚔️ You need **${WEEKLY_MIN_GAMES}** ranked games this week to claim (you have **${games}**).`);
  }

  const bracket = bracketOf(pvp_rating).name;
  const rewardRes = await pool.query(
    'SELECT weekly_credux, weekly_payload FROM ranked_reward WHERE bracket = $1', [bracket]
  );
  if (rewardRes.rows.length === 0) return reply(message, 'No reward configured for your bracket.');
  const { weekly_credux, weekly_payload } = rewardRes.rows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [me]);
    const grants = [];
    if (Number(weekly_credux) > 0) {
      await client.query('UPDATE users_bag SET credux = credux + $2 WHERE discord_id = $1', [me, weekly_credux]);
      grants.push(`${Number(weekly_credux).toLocaleString()} Credux`);
    }
    for (const entry of (weekly_payload || [])) {
      const col = ITEM_COLUMN[entry.item];
      const qty = Number(entry.qty) || 1;
      if (col) {
        await client.query(`UPDATE users_bag SET ${col} = ${col} + $2 WHERE discord_id = $1`, [me, qty]);
        grants.push(`${qty}× ${entry.item.replace(/_/g, ' ')}`);
      }
    }
    await client.query('UPDATE user_character SET last_weekly_claim_week = $2 WHERE discord_id = $1', [me, week]);
    await client.query('COMMIT');

    const container = new ContainerBuilder()
      .setAccentColor(GOLD)
      .addTextDisplayComponents((td) => td.setContent(`## 🏅 ${bracket} Weekly Reward`))
      .addSeparatorComponents(sep)
      .addTextDisplayComponents((td) => td.setContent(`Granted: **${grants.join('** · **')}**`));
    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { repliedUser: false } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ranked claim]', err);
    return reply(message, 'Claim failed — nothing was granted.');
  } finally {
    client.release();
  }
}

// ── dispatcher ─────────────────────────────────────────────────────────────
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'claim') return claim(message);
  return fight(message);
}

module.exports = { execute };
