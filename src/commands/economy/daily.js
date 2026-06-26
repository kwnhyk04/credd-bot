'use strict';

/**
 * `crd daily` — collect the daily attendance reward (Master §19, Phase 8).
 *
 * Two streaks (users.monthly_streak 1–30 rolling, overall_streak lifetime-consecutive).
 * Resets midnight PHT. A consecutive day advances both; a missed day (or first claim)
 * resets both to Day 1. Rewards (Credux + Belief Shards + a Silver/Gold chest) scale by
 * the monthly day position per the §19 tables.
 *
 * NOTE on §19 wording: "Overall Streak … never resets" is read as "never resets on the
 * 30-day cycle boundary"; a *missed day* still resets both streaks ("Miss a day → FULL
 * RESET of both streaks"). Flagged for confirmation.
 *
 * Lock order: users_bag → users (Phase-5 convention; same as bestow). game_logs rows use
 * action 'Daily' (credux / shards / chest).
 */

const {
  ContainerBuilder, SeparatorSpacingSize, MediaGalleryBuilder, AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const pool = require('../../db/pool');
const { emojiForDisplay } = require('../../utils/emojis');

const TODAY = `(NOW() AT TIME ZONE 'Asia/Manila')::date`;
const ACCENT = 0xf0b232;
const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);

const BANNER_PATH = path.join(__dirname, '..', '..', '..', 'assets', 'quest icons', 'attendance.png');
// [v4.8] The raw attendance icon rendered at full media-gallery width (oversized). Composite it
// smaller and centered on a transparent panel so it reads as a proportional badge on the card.
const ICON_MAX_H = 132;
const PANEL_W = 420;
const PANEL_H = ICON_MAX_H + 16;
let bannerPromise; // cached Promise<Buffer|null>
function banner() {
  if (bannerPromise !== undefined) return bannerPromise;
  bannerPromise = (async () => {
    try {
      if (!fs.existsSync(BANNER_PATH)) return null;
      const img = await loadImage(BANNER_PATH);
      const scale = Math.min((PANEL_W - 16) / img.width, ICON_MAX_H / img.height);
      const w = img.width * scale, h = img.height * scale;
      const canvas = createCanvas(PANEL_W, PANEL_H);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, (PANEL_W - w) / 2, (PANEL_H - h) / 2, w, h);
      return canvas.toBuffer('image/png');
    } catch { return null; }
  })();
  return bannerPromise;
}

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

const GOLD_DAYS = new Set([7, 14, 21, 28, 29, 30]);

/** §19 reward by monthly day position (1–30). Chest columns are whitelisted. */
function dailyReward(day) {
  const gold = GOLD_DAYS.has(day);
  let credux; let shards;
  if (day === 30) [credux, shards] = [25000, 35];
  else if (day === 29) [credux, shards] = [18000, 28];
  else if (day === 28) [credux, shards] = [15000, 25];
  else if (day >= 22) [credux, shards] = [4000, 10];   // 22–27
  else if (day === 21) [credux, shards] = [12000, 20];
  else if (day >= 15) [credux, shards] = [3000, 8];    // 15–20
  else if (day === 14) [credux, shards] = [8000, 15];
  else if (day >= 8) [credux, shards] = [2000, 5];     // 8–13
  else if (day === 7) [credux, shards] = [5000, 10];
  else [credux, shards] = [1000, 3];                   // 1–6
  return {
    credux, shards,
    chestCol: gold ? 'gold_chest' : 'silver_chest',
    chestLabel: gold ? 'Gold Chest' : 'Silver Chest',
  };
}

/**
 * Claim core (runs inside the caller's transaction). bypass = ignore the once-per-day
 * lock and treat the claim as consecutive (dev testing). Returns a tagged result.
 */
async function claimDaily(client, discordId, { bypass = false } = {}) {
  // bag first (Phase-5 lock order), then users
  const bagRes = await client.query(
    'SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [discordId]
  );
  if (bagRes.rows.length === 0) return { status: 'missing' };

  const uRes = await client.query(
    `SELECT monthly_streak, overall_streak,
            (last_daily_claim_date = ${TODAY})                     AS claimed_today,
            (last_daily_claim_date = ${TODAY} - INTERVAL '1 day')  AS claimed_yesterday
       FROM users WHERE discord_id = $1 FOR UPDATE`,
    [discordId]
  );
  if (uRes.rows.length === 0) return { status: 'missing' };
  const u = uRes.rows[0];
  if (u.claimed_today && !bypass) {
    return { status: 'already', monthly: Number(u.monthly_streak), overall: Number(u.overall_streak) };
  }

  const consecutive = bypass || u.claimed_yesterday === true;
  const monthly = consecutive ? (Number(u.monthly_streak) % 30) + 1 : 1;
  const overall = consecutive ? Number(u.overall_streak) + 1 : 1;
  const rw = dailyReward(monthly);
  const col = rw.chestCol; // whitelisted literal

  const bagUpd = await client.query(
    `UPDATE users_bag
        SET credux = credux + $2, belief_shards = belief_shards + $3, ${col} = ${col} + 1,
            lifetime_credux_earned = lifetime_credux_earned + $2
      WHERE discord_id = $1
      RETURNING credux, belief_shards, ${col} AS chest_count`,
    [discordId, rw.credux, rw.shards]
  );
  const after = bagUpd.rows[0];

  await client.query(
    `UPDATE users SET monthly_streak = $2, overall_streak = $3, last_daily_claim_date = ${TODAY}
      WHERE discord_id = $1`,
    [discordId, monthly, overall]
  );

  // game_logs — action 'Daily', one row per currency/item
  await client.query(
    `INSERT INTO game_logs (discord_id, action, previous_credux, updated_credux)
     VALUES ($1, 'Daily', $2, $3)`,
    [discordId, Number(after.credux) - rw.credux, Number(after.credux)]
  );
  await client.query(
    `INSERT INTO game_logs (discord_id, action, previous_belief_shards, updated_belief_shards)
     VALUES ($1, 'Daily', $2, $3)`,
    [discordId, Number(after.belief_shards) - rw.shards, Number(after.belief_shards)]
  );
  await client.query(
    `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
     VALUES ($1, 'Daily', $2, $3, $4)`,
    [discordId, col, Number(after.chest_count) - 1, Number(after.chest_count)]
  );

  return {
    status: 'ok', day: monthly, monthly, overall,
    credux: rw.credux, shards: rw.shards, chestLabel: rw.chestLabel,
  };
}

/** CV2 reward card (§19 layout). */
async function buildDailyPayload(result) {
  const creduxIcon = emojiForDisplay('Credux Coin', '💰');
  const shardIcon = emojiForDisplay('Belief Shards', '🔮');
  const chestIcon = emojiForDisplay(result.chestLabel, '🎁');

  const container = new ContainerBuilder().setAccentColor(ACCENT);
  const files = [];
  const buf = await banner();
  if (buf) {
    files.push(new AttachmentBuilder(buf, { name: 'attendance.png' }));
    container.addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL('attachment://attendance.png')));
  }
  container
    .addTextDisplayComponents((td) => td.setContent(`## 📅 Daily Attendance — Day ${result.day}`))
    .addTextDisplayComponents((td) => td.setContent(`-# Month: ${result.monthly} / 30 · Overall: ${result.overall} days`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `${creduxIcon} **+${result.credux.toLocaleString()}** Credux\n` +
      `${shardIcon} **+${result.shards}** Belief Shards\n` +
      `${chestIcon} **+1** ${result.chestLabel}`
    ))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# *"The gods take note of your devotion."*'));

  return { components: [container], files, flags: MessageFlags.IsComponentsV2 };
}

async function execute(message) {
  const discordId = message.author.id;
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    result = await claimDaily(client, discordId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[daily]', err);
    return reply(message, { content: 'Daily claim failed — nothing was changed.' });
  } finally {
    client.release();
  }

  if (result.status === 'missing') {
    return reply(message, { content: 'You are not registered yet — use `crd register` first.' });
  }
  if (result.status === 'already') {
    return reply(message, {
      content: `⏳ You already claimed today (Day ${result.monthly}). Come back after midnight PHT.`,
    });
  }
  return reply(message, await buildDailyPayload(result));
}

module.exports = { execute, claimDaily, dailyReward, buildDailyPayload };
