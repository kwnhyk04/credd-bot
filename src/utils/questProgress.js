'use strict';

/**
 * Daily quests — roll, progress, auto-grant (Master §20, Phase 8).
 *
 * Pool (matches daily_quests.quest_type): raid_wins / elite_defeats / credux_spent /
 * weapon_enhancements / duel_wins / duel_challenges. 3 distinct types per player per
 * day, target randomized within the §20 ranges, reward fixed by the §20 count-scaled
 * tables at roll time.
 *
 * SCHEMA NOTE (frozen): daily_quests.target_count / current_count are SMALLINT
 * (max 32,767), but the §20 `credux_spent` quest ranges to 50,000. We therefore store
 * credux_spent target + progress in UNITS OF 1,000 (target 5..50). This is LOSSLESS:
 * every enhancement Credux cost (§7 ENHANCE_COST) is a clean multiple of 1,000, so the
 * progress increment `cost / 1000` is always a whole number. All other quest types have
 * targets ≤ 10 and fit SMALLINT directly. `progressUnit` carries the 1,000 multiplier
 * for display/reward-banding.
 *
 * Roll path is shared by the midnight scheduler and the lazy on-demand roll; it is made
 * race-safe by a per-user advisory xact-lock plus the UNIQUE(discord_id, quest_type,
 * quest_date) backstop (ON CONFLICT DO NOTHING).
 *
 * progressQuests runs INSIDE the caller's open transaction and assumes the caller
 * already holds that user's users_bag row lock (global lock order: bag → character →
 * quests). Reaching a target flips `completed` (the flag UPDATE is the once-only grant
 * guard) and credits users_bag + one game_logs row per currency (action 'Quest').
 */

const TODAY_PHT = `(NOW() AT TIME ZONE 'Asia/Manila')::date`;

// §20 v4.2 revision: each player may refresh up to 2 quest lines per day. Usage is
// tracked PHT-anchored on users.quest_refreshes_today / last_quest_refresh_date
// (mirrors the bestow daily-cap pattern; requires the Phase-8 ALTER on users).
const REFRESH_ALLOWANCE = 2;

const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

// Each def: target range (rolled units), reward(rolledUnits) → [credux, shards],
// label(rolledUnits) → string, progressUnit (display multiplier; 1000 for credux_spent).
const QUEST_DEFS = {
  raid_wins: {
    progressUnit: 1,
    roll: (rng) => randInt(rng, 3, 10),
    reward: (n) => (n <= 5 ? [3000, 5] : n <= 8 ? [6000, 10] : [10000, 15]),
    label: (n) => `Win ${n} raids`,
  },
  elite_defeats: {
    progressUnit: 1,
    roll: (rng) => randInt(rng, 2, 5),
    reward: (n) => (n <= 3 ? [5000, 8] : [10000, 15]),
    label: (n) => `Defeat ${n} elite mobs`,
  },
  credux_spent: {
    progressUnit: 1000, // stored in thousands; actual target = n × 1,000
    roll: (rng) => randInt(rng, 5, 50), // 5,000 .. 50,000 (multiples of 1,000)
    reward: (n) => (n <= 20 ? [4000, 5] : [9000, 12]),
    label: (n) => `Spend ${(n * 1000).toLocaleString()} Credux on enhancement`,
  },
  weapon_enhancements: {
    progressUnit: 1,
    roll: (rng) => randInt(rng, 2, 5),
    reward: (n) => (n <= 3 ? [4000, 5] : [8000, 10]),
    label: (n) => `Enhance a weapon ${n} times`,
  },
  duel_wins: {
    progressUnit: 1,
    roll: (rng) => randInt(rng, 1, 3),
    reward: (n) => (n <= 1 ? [5000, 8] : [12000, 18]),
    label: (n) => `Win ${n} duel${n > 1 ? 's' : ''}`,
  },
  duel_challenges: {
    progressUnit: 1,
    roll: (rng) => randInt(rng, 2, 5),
    reward: (n) => (n <= 3 ? [3000, 5] : [6000, 10]),
    label: (n) => `Challenge ${n} players to a duel`,
  },
};

const QUEST_TYPES = Object.keys(QUEST_DEFS);

/** Fisher–Yates using the provided rng (defaults to Math.random). */
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Roll 3 distinct quests for (discordId, today PHT) if none exist yet. Must be called
 * with a client whose transaction is open; the advisory xact-lock holds until that tx
 * ends. Returns true if it rolled, false if quests already existed. rng injectable.
 */
async function rollQuestsIfMissing(client, discordId, rng = Math.random) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`quests:${discordId}`]);

  const existing = await client.query(
    `SELECT 1 FROM daily_quests WHERE discord_id = $1 AND quest_date = ${TODAY_PHT} LIMIT 1`,
    [discordId]
  );
  if (existing.rows.length > 0) return false;

  const types = shuffle(QUEST_TYPES, rng).slice(0, 3);
  for (const type of types) {
    const def = QUEST_DEFS[type];
    const target = def.roll(rng);
    const [credux, shards] = def.reward(target);
    await client.query(
      `INSERT INTO daily_quests
         (discord_id, quest_type, target_count, current_count, reward_credux, reward_belief_shards, quest_date)
       VALUES ($1, $2, $3, 0, $4, $5, ${TODAY_PHT})
       ON CONFLICT (discord_id, quest_type, quest_date) DO NOTHING`,
      [discordId, type, target, credux, shards]
    );
  }
  return true;
}

/** `📋 Quest complete: <label> — +X Credux, +Y Shards` */
function completionNotice(questType, target, credux, shards) {
  const def = QUEST_DEFS[questType];
  const label = def ? def.label(target) : questType;
  return `📋 Quest complete: ${label} — +${Number(credux).toLocaleString()} Credux, +${shards} Shards`;
}

/**
 * Apply progress deltas to today's quests for one player and auto-grant any that
 * complete. Runs inside the caller's transaction; the caller MUST already hold the
 * user's users_bag row lock (bag → character → quests order). `deltas` maps quest_type
 * → increment (already in stored units, e.g. credux_spent in thousands). Returns an
 * array of completion-notice strings (one per newly-completed quest).
 */
async function progressQuests(client, discordId, deltas) {
  await rollQuestsIfMissing(client, discordId);

  const notices = [];
  for (const [type, raw] of Object.entries(deltas)) {
    const inc = Math.floor(raw);
    if (!(inc > 0)) continue;

    const upd = await client.query(
      `UPDATE daily_quests
          SET current_count = LEAST(target_count, current_count + $3)
        WHERE discord_id = $1 AND quest_date = ${TODAY_PHT}
          AND quest_type = $2 AND completed = FALSE
        RETURNING id, target_count, current_count, reward_credux, reward_belief_shards`,
      [discordId, type, inc]
    );
    if (upd.rows.length === 0) continue;
    const q = upd.rows[0];
    if (q.current_count < q.target_count) continue;

    // reached target → flip completed (once-only guard) then grant
    const done = await client.query(
      'UPDATE daily_quests SET completed = TRUE WHERE id = $1 AND completed = FALSE RETURNING id',
      [q.id]
    );
    if (done.rows.length === 0) continue; // lost the race; already granted

    const credux = Number(q.reward_credux);
    const shards = Number(q.reward_belief_shards);
    const bag = await client.query(
      `UPDATE users_bag SET credux = credux + $2, belief_shards = belief_shards + $3
        WHERE discord_id = $1 RETURNING credux, belief_shards`,
      [discordId, credux, shards]
    );
    if (bag.rows.length === 0) continue; // no bag row (shouldn't happen for a player)
    const afterC = Number(bag.rows[0].credux);
    const afterS = Number(bag.rows[0].belief_shards);
    if (credux > 0) {
      await client.query(
        `INSERT INTO game_logs (discord_id, action, previous_credux, updated_credux)
         VALUES ($1, 'Quest', $2, $3)`,
        [discordId, afterC - credux, afterC]
      );
    }
    if (shards > 0) {
      await client.query(
        `INSERT INTO game_logs (discord_id, action, previous_belief_shards, updated_belief_shards)
         VALUES ($1, 'Quest', $2, $3)`,
        [discordId, afterS - shards, afterS]
      );
    }
    notices.push(completionNotice(type, q.target_count, credux, shards));
  }
  return notices;
}

/** Refreshes used today (PHT-anchored; stale date → 0). */
async function getRefreshesUsed(client, discordId) {
  const res = await client.query(
    `SELECT quest_refreshes_today, (last_quest_refresh_date = ${TODAY_PHT}) AS is_today
       FROM users WHERE discord_id = $1`,
    [discordId]
  );
  if (res.rows.length === 0) return 0;
  const r = res.rows[0];
  return r.is_today ? Number(r.quest_refreshes_today) : 0;
}

/**
 * Reroll ONE quest line (0-based index over today's quests ordered by id) into a fresh
 * quest of a type not currently in use, resetting its progress. Consumes one refresh
 * unless bypassMax (dev). Must run inside the caller's open transaction. Returns a tagged
 * result: ok / max / badindex / noalt.
 */
async function refreshQuestLine(client, discordId, index, { bypassMax = false, rng = Math.random } = {}) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`quests:${discordId}`]);
  await rollQuestsIfMissing(client, discordId, rng);

  const used = await getRefreshesUsed(client, discordId);
  if (!bypassMax && used >= REFRESH_ALLOWANCE) {
    return { status: 'max', used, allowance: REFRESH_ALLOWANCE };
  }

  const qres = await client.query(
    `SELECT id, quest_type FROM daily_quests
      WHERE discord_id = $1 AND quest_date = ${TODAY_PHT} ORDER BY id`,
    [discordId]
  );
  const quests = qres.rows;
  if (index < 0 || index >= quests.length) return { status: 'badindex', count: quests.length };

  const inUse = new Set(quests.map((q) => q.quest_type));
  const candidates = QUEST_TYPES.filter((t) => !inUse.has(t));
  if (candidates.length === 0) return { status: 'noalt' }; // 6 types, 3 in use → never empty
  const newType = candidates[Math.floor(rng() * candidates.length)];
  const def = QUEST_DEFS[newType];
  const target = def.roll(rng);
  const [credux, shards] = def.reward(target);

  await client.query(
    `UPDATE daily_quests
        SET quest_type = $2, target_count = $3, current_count = 0,
            reward_credux = $4, reward_belief_shards = $5, completed = FALSE
      WHERE id = $1`,
    [quests[index].id, newType, target, credux, shards]
  );

  let newUsed = used;
  if (!bypassMax) {
    newUsed = used + 1;
    await client.query(
      `UPDATE users SET quest_refreshes_today = $2, last_quest_refresh_date = ${TODAY_PHT}
        WHERE discord_id = $1`,
      [discordId, newUsed]
    );
  }
  return {
    status: 'ok',
    position: index + 1,
    used: newUsed,
    allowance: REFRESH_ALLOWANCE,
    bypassed: bypassMax,
    newQuest: describeQuest({
      quest_type: newType, target_count: target, current_count: 0,
      reward_credux: credux, reward_belief_shards: shards, completed: false,
    }),
  };
}

/** Shape a daily_quests row for rendering (actual-unit current/target + reward). */
function describeQuest(row) {
  const def = QUEST_DEFS[row.quest_type] || { progressUnit: 1, label: () => row.quest_type };
  const unit = def.progressUnit;
  return {
    type: row.quest_type,
    name: def.label(row.target_count),
    current: Number(row.current_count) * unit,
    target: Number(row.target_count) * unit,
    rewardCredux: Number(row.reward_credux),
    rewardShards: Number(row.reward_belief_shards),
    completed: row.completed === true,
  };
}

/** Whole hours remaining until the next midnight PHT (rounded up, min 1). */
function hoursUntilMidnightPHT(now = new Date()) {
  // PHT = UTC+8, no DST. Compute the current PHT wall-clock from the UTC instant.
  const phtMs = now.getTime() + 8 * 3600_000;
  const msIntoDay = ((phtMs % 86_400_000) + 86_400_000) % 86_400_000;
  const msLeft = 86_400_000 - msIntoDay;
  return Math.max(1, Math.ceil(msLeft / 3600_000));
}

module.exports = {
  QUEST_DEFS,
  QUEST_TYPES,
  REFRESH_ALLOWANCE,
  rollQuestsIfMissing,
  progressQuests,
  refreshQuestLine,
  getRefreshesUsed,
  describeQuest,
  completionNotice,
  hoursUntilMidnightPHT,
};
