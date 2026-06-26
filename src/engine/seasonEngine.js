'use strict';

/**
 * Season engine (v5 Phase 5). One 2-month clock drives:
 *   - season-end ranked payout by PEAK bracket (ranked_reward.season_end_payload)
 *   - soft ranked reset (rating × 0.6, floor 1000; peak/shield reset)
 *   - season-rank title grant (Divine = rotating exclusive; lower = per-season title)
 *   - activation of the next season
 * Banner + reward track are intentionally NOT handled here (deferred).
 */

const { bracketOf } = require('../config/ranked');
const { divineSeasonTitle } = require('../config/titles');
const { grantTitle } = require('../utils/titleGrant');

const SEASON_DAYS = 60; // 2 months

// payload item key → users_bag column
const ITEM_COLUMN = {
  silver_chest: 'silver_chest',
  gold_chest: 'gold_chest',
  boss_treasure: 'boss_treasure_chest',
  boss_golden: 'boss_golden_chest',
  supreme_chest: 'supreme_chest',
  sacred_relic: 'sacred_relics',
  supreme_relic: 'supreme_relics',
};

/** Lower-bracket per-season title: ensure a catalog row, return its code. */
async function ensureSeasonTitle(client, seasonId, seasonName, bracket) {
  const code = `season_${seasonId}_${bracket.toLowerCase()}`;
  await client.query(
    `INSERT INTO title_catalog (code, display, source, is_repeatable, how_to)
     VALUES ($1, $2, 'rank_season', FALSE, $3)
     ON CONFLICT (code) DO NOTHING`,
    [code, `${seasonName} — ${bracket}`, `Season-end reward for reaching ${bracket} in ${seasonName}.`]
  );
  return code;
}

/** Grant one season-end payload to a player at a given peak bracket. */
async function grantSeasonEnd(client, discordId, bracket, payload, seasonId, seasonName) {
  const bagSets = [];
  const bagParams = [discordId];
  for (const entry of (payload || [])) {
    if (entry.type === 'title') {
      const code = bracket === 'Divine'
        ? divineSeasonTitle(seasonId)
        : await ensureSeasonTitle(client, seasonId, seasonName, bracket);
      await grantTitle(client, discordId, code);
    } else if (entry.item === 'credux') {
      bagParams.push(Number(entry.qty) || 0);
      bagSets.push(`credux = credux + $${bagParams.length}`);
    } else if (ITEM_COLUMN[entry.item]) {
      const col = ITEM_COLUMN[entry.item];
      bagParams.push(Number(entry.qty) || 1);
      bagSets.push(`${col} = ${col} + $${bagParams.length}`);
    }
  }
  if (bagSets.length) {
    await client.query(`UPDATE users_bag SET ${bagSets.join(', ')} WHERE discord_id = $1`, bagParams);
  }
}

/**
 * Roll over the active season if its window has ended. Idempotent: returns
 * { rolled:false } when no due season. db = pool.
 */
async function rolloverIfDue(db, { force = false } = {}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const sres = await client.query(
      `SELECT season_id, name FROM seasons
        WHERE is_active = TRUE AND (${force ? 'TRUE' : 'ends_at <= NOW()'})
        ORDER BY ends_at LIMIT 1 FOR UPDATE`
    );
    if (sres.rows.length === 0) { await client.query('ROLLBACK'); return { rolled: false }; }
    const season = sres.rows[0];

    const rwRes = await client.query('SELECT bracket, season_end_payload FROM ranked_reward');
    const payloadByBracket = Object.fromEntries(rwRes.rows.map((r) => [r.bracket, r.season_end_payload]));

    const players = await client.query('SELECT discord_id, pvp_peak FROM user_character');
    let paid = 0;
    for (const pl of players.rows) {
      const bracket = bracketOf(pl.pvp_peak).name;
      const payload = payloadByBracket[bracket];
      if (payload && payload.length) {
        await grantSeasonEnd(client, pl.discord_id, bracket, payload, season.season_id, season.name);
        paid += 1;
      }
    }

    // soft ranked reset for everyone
    await client.query(
      `UPDATE user_character
          SET pvp_rating = GREATEST(1000, FLOOR(pvp_rating * 0.6)::int),
              pvp_peak = GREATEST(1000, FLOOR(pvp_rating * 0.6)::int),
              pvp_demotion_shield = TRUE`
    );

    // close this season, open the next (banner featured_deity left NULL — deferred)
    await client.query('UPDATE seasons SET is_active = FALSE WHERE season_id = $1', [season.season_id]);
    const next = await client.query(
      `INSERT INTO seasons (name, theme, starts_at, ends_at, is_active)
       VALUES ($1, NULL, NOW(), NOW() + ($2 || ' days')::interval, TRUE)
       RETURNING season_id`,
      [`Season ${season.season_id + 1}`, String(SEASON_DAYS)]
    );

    await client.query('COMMIT');
    return { rolled: true, endedSeason: season.season_id, paid, nextSeason: next.rows[0].season_id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Start a fresh active season now (dev/bootstrap). Deactivates any current one. */
async function startSeason(db, name) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE seasons SET is_active = FALSE WHERE is_active = TRUE');
    const res = await client.query(
      `INSERT INTO seasons (name, starts_at, ends_at, is_active)
       VALUES ($1, NOW(), NOW() + ($2 || ' days')::interval, TRUE)
       RETURNING season_id, name, ends_at`,
      [name || 'Season 1', String(SEASON_DAYS)]
    );
    await client.query('COMMIT');
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Force the active season to end now (so the next rolloverIfDue fires). */
async function endSeasonNow(db) {
  const res = await db.query(
    'UPDATE seasons SET ends_at = NOW() WHERE is_active = TRUE RETURNING season_id'
  );
  return res.rows[0] || null;
}

async function activeSeason(db) {
  const res = await db.query(
    'SELECT season_id, name, starts_at, ends_at FROM seasons WHERE is_active = TRUE ORDER BY ends_at LIMIT 1'
  );
  return res.rows[0] || null;
}

module.exports = { rolloverIfDue, startSeason, endSeasonNow, activeSeason };
