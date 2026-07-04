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

const { randomUUID } = require('crypto');
const { ContainerBuilder, MessageFlags } = require('discord.js');
const pool = require('../../db/pool');
const { resolveBattle } = require('../../engine/battleEngine');
const { buildPlayerFighter } = require('../../engine/statAssembly');
const { runBattle } = require('../../engine/battleRender');
const { resolveSkin } = require('../../engine/skinResolver');
const { activeSeason } = require('../../engine/seasonEngine');
const {
  bracketOf, bracketFloor, bracketIndex, matchRange, matchRangeWide,
  eloDelta, valorForResult, phtWeek, WEEKLY_MIN_GAMES,
} = require('../../config/ranked');
const { smallDivider: sep } = require('../../utils/componentsV2');

const GOLD = 0xf0b232;
const RANKED_FIGHT_LOCK_MINUTES = 10;

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

async function acquireRankedFightLock(discordId) {
  const token = randomUUID();
  const res = await pool.query(
    `INSERT INTO active_ranked_fights (discord_id, lock_token, started_at, expires_at)
     VALUES ($1, $2, NOW(), NOW() + ($3::int * INTERVAL '1 minute'))
     ON CONFLICT (discord_id) DO UPDATE
        SET lock_token = EXCLUDED.lock_token,
            started_at = EXCLUDED.started_at,
            expires_at = EXCLUDED.expires_at
      WHERE active_ranked_fights.expires_at <= NOW()
     RETURNING lock_token`,
    [discordId, token, RANKED_FIGHT_LOCK_MINUTES]
  );
  return res.rows.length > 0 ? token : null;
}

async function releaseRankedFightLock(discordId, token) {
  await pool.query(
    'DELETE FROM active_ranked_fights WHERE discord_id = $1 AND lock_token = $2',
    [discordId, token]
  );
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
  const lockToken = await acquireRankedFightLock(me);
  if (!lockToken) {
    return reply(message, '⚔️ You already have a ranked fight in progress — wait for it to finish.');
  }

  try {
  const selfRes = await pool.query(
    'SELECT pvp_rating, pvp_demotion_shield, pvp_peak FROM user_character WHERE discord_id = $1',
    [me]
  );
  if (selfRes.rows.length === 0) return reply(message, 'No character found.');
  const self = selfRes.rows[0];
  const rating = self.pvp_rating;
  const season = await activeSeason(pool);
  const inSeason = !!season;

  // Avoid an immediate rematch: the most recent opponent is excluded first, so a
  // thin bracket doesn't pit you against the same player twice in a row.
  const lastRes = await pool.query(
    'SELECT opponent_id FROM ranked_logs WHERE player_id = $1 ORDER BY timestamp DESC LIMIT 1',
    [me]
  );
  const lastOpp = lastRes.rows[0]?.opponent_id || null;

  // Pull a random eligible opponent in a rating window. exclude=true drops the
  // just-fought player; widen jumps from ±1 to ±2 brackets when the pool is thin.
  async function pickOpponent(span, excludeLast) {
    const { lo, hi } = matchRangeWide(rating, span);
    const params = [lo, hi, me];
    let extra = '';
    if (excludeLast && lastOpp) { params.push(lastOpp); extra = `AND uc.discord_id <> $${params.length}`; }
    const res = await pool.query(
      `SELECT uc.discord_id, uc.pvp_rating
         FROM user_character uc JOIN users u ON u.discord_id = uc.discord_id
        WHERE uc.pvp_rating BETWEEN $1 AND $2 AND uc.discord_id <> $3 ${extra}
        ORDER BY random() LIMIT 1`,
      params
    );
    return res.rows[0] || null;
  }

  // ±1 (no rematch) → ±2 (no rematch) → ±2 (allow rematch as last resort).
  let opp = await pickOpponent(1, true);
  if (!opp) opp = await pickOpponent(2, true);
  if (!opp) opp = await pickOpponent(2, false);
  if (!opp) {
    return reply(message, '⚔️ No eligible opponent in your bracket range right now — try again later.');
  }
  const oppRating = Number(opp.pvp_rating);

  // Ranked fights at TRUE levels/stats/equipment — no normalization (build + level both matter).
  const [p1, p2] = await Promise.all([
    buildPlayerFighter(pool, me),
    buildPlayerFighter(pool, opp.discord_id),
  ]);
  if (!p1 || !p2) return reply(message, 'Ranked cancelled — a combatant has no character.');

  const sim = resolveBattle(p1, p2, { mode: 'duel', seed: Date.now() >>> 0 });
  const won = sim.winner === 'a';
  let ratingBefore;
  let delta;
  let medals;
  let newRating;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bagRes = await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [me]);
    if (bagRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'Ranked cancelled — your bag could not be found.');
    }
    const lockedRes = await client.query(
      'SELECT pvp_rating, pvp_demotion_shield, pvp_peak FROM user_character WHERE discord_id = $1 FOR UPDATE',
      [me]
    );
    if (lockedRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'Ranked cancelled — your character could not be found.');
    }

    const locked = lockedRes.rows[0];
    ratingBefore = Number(locked.pvp_rating);
    delta = eloDelta(ratingBefore, oppRating, won);          // dynamic — scales with rank gap
    medals = inSeason ? valorForResult(ratingBefore, oppRating, won) : 0; // Rating always moves; Valor is seasonal.
    const { rating: nextRating, shield } = applyRating(ratingBefore, locked.pvp_demotion_shield, delta);
    newRating = nextRating;
    const newPeak = Math.max(Number(locked.pvp_peak || 0), newRating);

    await client.query(
      `UPDATE user_character SET pvp_rating = $2, pvp_demotion_shield = $3, pvp_peak = $4 WHERE discord_id = $1`,
      [me, newRating, shield, newPeak]
    );
    if (medals > 0) {
      await client.query(
        'UPDATE users_bag SET valor_medals = valor_medals + $2 WHERE discord_id = $1',
        [me, medals]
      );
    }
    await client.query(
      `INSERT INTO ranked_logs (player_id, opponent_id, result, rating_before, rating_after)
       VALUES ($1, $2, $3, $4, $5)`,
      [me, opp.discord_id, won ? 'win' : 'loss', ratingBefore, newRating]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ranked fight]', err);
    return reply(message, 'Ranked result failed — no rating or rewards were changed.');
  } finally {
    client.release();
  }

  // Result rendered INSIDE the embed (Phase 6): the tier matchup sits in the HEADER
  // (embed author, top), the outcome + rating move + Valor in the footer (bottom).
  const sign = delta >= 0 ? '+' : '';
  const myBracket = bracketOf(newRating);
  const oppBracket = bracketOf(oppRating);
  const myTier = bracketIndex(myBracket.name) + 1;
  const oppTier = bracketIndex(oppBracket.name) + 1;
  const opponentMention = `<@${opp.discord_id}>`;
  const header = `You: Tier ${myTier} ${myBracket.name}   ·   ${opponentMention}: Tier ${oppTier} ${oppBracket.name}`;
  const valorText = inSeason ? `+${medals} Valor` : 'No Valor - off season';
  const footer = `${won ? '🏆 Victory' : '💀 Defeat'} vs ${opponentMention}  ·  Rating ${sign}${delta} → ${newRating} (${myBracket.name})  ·  ${valorText}`;

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
    mode: 'duel', sim, header, footer, battleSkinPath, resultSkinPath,
  });
  } finally {
    await releaseRankedFightLock(me, lockToken).catch((err) => {
      console.error('[ranked fight lock release]', err.message);
    });
  }
}

// ── crd ranked claim — weekly bracket reward ───────────────────────────────
async function claim(message) {
  const me = message.author.id;
  const week = phtWeek();
  const season = await activeSeason(pool);
  if (!season) {
    return reply(message, '⚔️ No active PvP season — weekly ranked rewards are closed.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bagRes = await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [me]);
    if (bagRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'No bag found.');
    }
    const charRes = await client.query(
      'SELECT pvp_rating, last_weekly_claim_week FROM user_character WHERE discord_id = $1 FOR UPDATE',
      [me]
    );
    if (charRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'No character found.');
    }
    const { pvp_rating, last_weekly_claim_week } = charRes.rows[0];

    if (last_weekly_claim_week === week) {
      await client.query('ROLLBACK');
      return reply(message, '✅ You already claimed this week\'s ranked reward. Come back next week.');
    }

    const gamesRes = await client.query(
      `SELECT count(*)::int AS n FROM ranked_logs
        WHERE player_id = $1
          AND (
            EXTRACT(ISOYEAR FROM (timestamp AT TIME ZONE 'Asia/Manila'))::int * 100
            + EXTRACT(WEEK FROM (timestamp AT TIME ZONE 'Asia/Manila'))::int
          ) = $2`,
      [me, week]
    );
    const games = gamesRes.rows[0].n;
    if (games < WEEKLY_MIN_GAMES) {
      await client.query('ROLLBACK');
      return reply(message, `⚔️ You need **${WEEKLY_MIN_GAMES}** ranked games this week to claim (you have **${games}**).`);
    }

    const bracket = bracketOf(pvp_rating).name;
    const rewardRes = await client.query(
      'SELECT weekly_credux, weekly_valor, weekly_payload FROM ranked_reward WHERE bracket = $1',
      [bracket]
    );
    if (rewardRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'No reward configured for your bracket.');
    }
    const { weekly_credux, weekly_valor, weekly_payload } = rewardRes.rows[0];

    const grants = [];
    if (Number(weekly_credux) > 0) {
      await client.query('UPDATE users_bag SET credux = credux + $2 WHERE discord_id = $1', [me, weekly_credux]);
      grants.push(`${Number(weekly_credux).toLocaleString()} Credux`);
    }
    if (Number(weekly_valor) > 0) {
      await client.query('UPDATE users_bag SET valor_medals = valor_medals + $2 WHERE discord_id = $1', [me, weekly_valor]);
      grants.push(`${Number(weekly_valor).toLocaleString()} Valor Medals`);
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
