'use strict';

/**
 * Source-agnostic deity-summon core (Master §4/§9, Blueprint GACHA).
 *
 * `runSummon` performs the per-roll gacha INSIDE a transaction the CALLER owns
 * (the caller does BEGIN/COMMIT/ROLLBACK and deducts the spend currency —
 * belief_shards for `crd summon`, a relic for `crd open sr|supr`). The engine
 * never touches the spend currency; it only writes the deity/essence/pity/
 * reputation state + per-pull game_logs rows. Any throw propagates so the
 * caller can ROLLBACK — nothing is ever half-committed.
 *
 * Atomicity guarantees (all within the caller's txn):
 *   - new deity      → INSERT user_deities (enh 1, curr = base)
 *   - duplicate      → tier-based essence in users_bag (+1 Epic, +2 Mythic, +5 Legendary, +10 Supreme)
 *   - pity           → advanced/reset per roll; relic-forced tiers leave it as-is
 *   - active_deity   → auto-set to the FIRST new deity if the player had none
 *   - reputation     → +10/pull (1,500/day PHT cap), believer level roll-up
 *   - one game_logs "Deity Pull" row per pull (essence on dupe; shards if summon)
 *
 * Within-batch dedupe: an in-memory ownedSet is seeded from user_deities and
 * updated as we insert, so the same not-yet-owned deity rolled twice in one
 * batch credits essence on the 2nd hit instead of violating UNIQUE(discord_id,
 * deity_id).
 */

const {
  TIER_ESSENCE_COLUMN,
  ESSENCE_PER_DUPLICATE,
  REPUTATION_PER_PULL,
  REP_DAILY_CAP,
  BELIEVER_EXP_PER_LEVEL,
  resolveRoll,
} = require('../config/gachaRates');
const { grantTitles, grantTitle } = require('../utils/titleGrant');
const { believerTitlesFor, COLLECTION_PANTHEON_KEEPER, MYTHOLOGY_COLLECTION } = require('../config/titles');

// Whitelisted essence columns — interpolated into SQL only from this constant
// map keyed by our own tier strings (never raw user input).
const ESSENCE_COLUMNS = ['epic_essence', 'mythic_essence', 'legendary_essence', 'supreme_essence'];

/**
 * @param {import('pg').PoolClient} client  caller's in-transaction client
 * @param {string} discordId
 * @param {object} opts
 * @param {number} opts.count               number of pulls (≥1)
 * @param {string|null} [opts.forceTier]    bypass the tier roll (relic supr → 'Supreme'); pity untouched
 * @param {object} [opts.log]               { shardsStart, shardsPerPull } to fill shard cols on each Deity Pull row
 * @returns {Promise<object>} { pulls, summary, finalPity, newActiveDeityId, reputationAwarded }
 */
async function runSummon(client, discordId, { count, forceTier = null, log = {} }) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`runSummon: invalid count ${count}`);
  }

  // ── Lock the player's bag (essence) + pity rows ──────────────────────────
  const bagRes = await client.query(
    `SELECT epic_essence, mythic_essence, legendary_essence, supreme_essence
       FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
    [discordId]
  );
  if (bagRes.rows.length === 0) throw new Error('runSummon: users_bag row missing');
  const essence = { ...bagRes.rows[0] }; // running balances

  let pityRes = await client.query(
    'SELECT pity_count FROM pity_counters WHERE discord_id = $1 FOR UPDATE',
    [discordId]
  );
  if (pityRes.rows.length === 0) {
    await client.query(
      'INSERT INTO pity_counters (discord_id) VALUES ($1) ON CONFLICT (discord_id) DO NOTHING',
      [discordId]
    );
    pityRes = await client.query(
      'SELECT pity_count FROM pity_counters WHERE discord_id = $1 FOR UPDATE',
      [discordId]
    );
  }
  let pity = pityRes.rows[0].pity_count;

  // ── Read character (active deity + reputation) + PHT "today" ─────────────
  const charRes = await client.query(
    `SELECT active_deity_id, believer_level, believer_exp,
            reputation_exp_today, reputation_exp_reset_date,
            (NOW() AT TIME ZONE 'Asia/Manila')::date AS pht_today
       FROM user_character WHERE discord_id = $1 FOR UPDATE`,
    [discordId]
  );
  if (charRes.rows.length === 0) throw new Error('runSummon: user_character row missing');
  const char = charRes.rows[0];

  // ── In-memory ownership set (seeded from DB, updated on insert) ───────────
  const ownedRes = await client.query(
    'SELECT deity_id FROM user_deities WHERE discord_id = $1',
    [discordId]
  );
  const ownedSet = new Set(ownedRes.rows.map(r => r.deity_id));

  // ── Single shard-spend row for the whole command (crd summon path only) ──
  // Relic paths spend no shards (the relic is the cost, logged by open.js), so
  // shardsPerPull is null there and no shard row is written.
  const shardsPerPull = log.shardsPerPull ?? null;
  if (shardsPerPull != null) {
    const shardsBefore = log.shardsStart;
    const shardsAfter = shardsBefore - shardsPerPull * count;
    await client.query(
      `INSERT INTO game_logs
         (discord_id, action, previous_belief_shards, updated_belief_shards)
       VALUES ($1, 'Deity Pull', $2, $3)`,
      [discordId, shardsBefore, shardsAfter]
    );
  }

  // ── Roll loop ────────────────────────────────────────────────────────────
  const pulls = [];
  let pendingActiveId = null; // first new deity, if the player has none active

  for (let i = 0; i < count; i++) {
    // Step 1 — tier (relic-forced tiers bypass the roll AND leave pity as-is).
    let tier;
    if (forceTier) {
      tier = forceTier;
    } else {
      const res = resolveRoll(pity);
      tier = res.tier;
      pity = res.newPity; // resolveRoll already applies the reset rule
    }

    // Step 2 — specific available deity in that tier.
    const deityRes = await client.query(
      `SELECT deity_id, name, mythology, tier, base_hp, base_atk, base_def, blessing_name
         FROM deity_roster
        WHERE tier = $1 AND is_available = TRUE
        ORDER BY RANDOM() LIMIT 1`,
      [tier]
    );
    if (deityRes.rows.length === 0) {
      throw new Error(`runSummon: no available deity for tier ${tier}`);
    }
    const d = deityRes.rows[0];

    const isDupe = ownedSet.has(d.deity_id);
    const essenceGained = isDupe ? ESSENCE_PER_DUPLICATE[tier] : 0;
    let userDeityId = null;

    if (isDupe) {
      // Duplicate → the configured amount of the deity's tier essence.
      // Only the running balance is updated here; the consolidated per-tier
      // essence log row is written once after the loop.
      essence[TIER_ESSENCE_COLUMN[tier]] += essenceGained;
    } else {
      // New deity → INSERT (enhancement 1 ⇒ curr = base, floor is identity).
      const ins = await client.query(
        `INSERT INTO user_deities
           (discord_id, deity_id, curr_atk, curr_hp, curr_def, enhancement, last_pull_date)
         VALUES ($1, $2, $3, $4, $5, 1, (NOW() AT TIME ZONE 'Asia/Manila')::date)
         RETURNING user_deity_id`,
        [discordId, d.deity_id, d.base_atk, d.base_hp, d.base_def]
      );
      userDeityId = ins.rows[0].user_deity_id;
      ownedSet.add(d.deity_id);
      if (char.active_deity_id == null && pendingActiveId == null) {
        pendingActiveId = userDeityId;
      }
      // No game_logs row for a new deity: there's no column for WHICH deity, and
      // user_deities already records acquisition + timestamp — an all-null row
      // would carry nothing. (Acquisition is auditable via user_deities.)
    }

    pulls.push({
      tier,
      deityId: d.deity_id,
      name: d.name,
      mythology: d.mythology,
      blessingName: d.blessing_name,
      isDupe,
      essence: essenceGained,
      userDeityId,
    });
  }

  // ── Persist essence deltas + write ONE consolidated log row per tier ──────
  // Iterate tiers in fixed order (epic→mythic→legendary→supreme). For each tier
  // that gained essence this command, both add it to the single UPDATE and emit
  // one "Deity Pull" row summing the gain: previous/updated = bag balance
  // before/after the aggregated add (item_type = full column name, e.g. 'epic_essence').
  const essenceUpdates = [];
  const essenceParams = [discordId];
  for (const col of ESSENCE_COLUMNS) {
    const before = bagRes.rows[0][col];
    const after = essence[col];
    if (after !== before) {
      essenceParams.push(after);
      essenceUpdates.push(`${col} = $${essenceParams.length}`);
      await client.query(
        `INSERT INTO game_logs
           (discord_id, action, item_type, previous_essence_count, updated_essence_count)
         VALUES ($1, 'Deity Pull', $2, $3, $4)`,
        [discordId, col, before, after]
      );
    }
  }
  if (essenceUpdates.length > 0) {
    await client.query(
      `UPDATE users_bag SET ${essenceUpdates.join(', ')} WHERE discord_id = $1`,
      essenceParams
    );
  }

  // ── Persist pity (no-op write when unchanged, e.g. relic-forced tiers) ────
  if (pity !== pityRes.rows[0].pity_count) {
    await client.query(
      'UPDATE pity_counters SET pity_count = $2 WHERE discord_id = $1',
      [discordId, pity]
    );
  }

  // ── Auto-set active deity to the first new pull (if none was active) ──────
  if (pendingActiveId != null) {
    await client.query(
      `UPDATE user_character SET active_deity_id = $2
        WHERE discord_id = $1 AND active_deity_id IS NULL`,
      [discordId, pendingActiveId]
    );
  }

  // ── Reputation: +10/pull, 1,500/day PHT cap, 3,000-flat level roll-up ────
  const reputationAwarded = await awardReputation(client, discordId, char, count);

  // ── Collection titles: per-mythology completion + full Pantheon Keeper ───
  if (pulls.some((p) => !p.isDupe)) {
    const coll = await client.query(
      `SELECT dr.mythology,
              count(*)::int AS avail,
              count(ud.user_deity_id)::int AS owned
         FROM deity_roster dr
         LEFT JOIN user_deities ud
           ON ud.deity_id = dr.deity_id AND ud.discord_id = $1
        WHERE dr.is_available = TRUE
        GROUP BY dr.mythology`,
      [discordId]
    );
    let totAvail = 0;
    let totOwned = 0;
    for (const row of coll.rows) {
      totAvail += row.avail;
      totOwned += row.owned;
      const code = MYTHOLOGY_COLLECTION[row.mythology];
      if (code && row.avail > 0 && row.owned >= row.avail) {
        await grantTitle(client, discordId, code);
      }
    }
    if (totAvail > 0 && totOwned >= totAvail) {
      await grantTitle(client, discordId, COLLECTION_PANTHEON_KEEPER);
    }
  }

  // ── Summary for the embed ────────────────────────────────────────────────
  const summary = { Epic: 0, Mythic: 0, Legendary: 0, Supreme: 0 };
  for (const p of pulls) summary[p.tier] += 1;

  return {
    pulls,
    summary,
    finalPity: pity,
    newActiveDeityId: pendingActiveId,
    reputationAwarded,
  };
}

/**
 * Credit believer reputation EXP inside the txn. Rolls over reputation_exp_today
 * when the PHT date changed (defensive — the midnight scheduler normally does
 * this), clamps to the 1,500/day cap, and applies flat 3,000-per-level ups
 * (believer_exp is within-level progress; remainder carries).
 */
async function awardReputation(client, discordId, char, count) {
  const today = char.pht_today;
  const resetDate = char.reputation_exp_reset_date;
  // Same PHT day? keep today's tally; otherwise the cap has rolled over.
  const sameDay = resetDate != null && resetDate.getTime() === today.getTime();
  const todaySoFar = sameDay ? char.reputation_exp_today : 0;

  const desired = REPUTATION_PER_PULL * count;
  const remainingCap = Math.max(0, REP_DAILY_CAP - todaySoFar);
  const awarded = Math.min(desired, remainingCap);

  let level = char.believer_level;
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
  // Believer-milestone titles for the (possibly new) level — idempotent grants.
  await grantTitles(client, discordId, believerTitlesFor(level));
  return awarded;
}

module.exports = { runSummon };
