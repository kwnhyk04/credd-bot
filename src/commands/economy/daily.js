'use strict';

/**
 * `crd daily` — collect the daily attendance reward (Master §19, Phase 8).
 *
 * Two counters: users.monthly_streak is the rolling 1–30 reward cycle, while
 * users.overall_streak is the current consecutive attendance streak. A consecutive PHT
 * day advances both; a missed day (or first claim) resets both to Day 1, preserving the
 * existing cycle behavior. Base rewards use the monthly day; milestone rewards use only
 * the consecutive streak, which continues across the monthly wrap.
 *
 * Lock order: users_bag → users (Phase-5 convention; same as bestow). game_logs rows use
 * action 'Daily' (credux / shards / chest).
 */

const {
  ContainerBuilder, MediaGalleryBuilder,
  MessageFlags,
} = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { encodeCanvas } = require('../../utils/canvasEncode');
const pool = require('../../db/pool');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emojiForDisplay } = require('../../utils/emojis');
const {
  assetPath, loadAssetImage: loadAssetImageSource,
  remoteAssetAvailable, getAssetUrl,
} = require('../../utils/assets');
const { makeOptimizedAttachment } = require('../../utils/imageOutput');

// [egress] The attendance banner is one fixed image — pre-rendered by
// scripts/build-casino-spin-assets.js and served from R2 when uploaded.
const BANNER_REL = 'generated/daily/attendance_banner.png';

const TODAY = `(NOW() AT TIME ZONE 'Asia/Manila')::date`;
const ACCENT = 0xf0b232;

const BANNER_PATH = assetPath('quest icons/attendance.png');
// [v4.8] The raw attendance icon rendered at full media-gallery width (oversized). Composite it
// smaller and centered on a transparent panel so it reads as a proportional badge on the card.
const ICON_MAX_H = 132;
const PANEL_W = 420;
const PANEL_H = ICON_MAX_H + 16;
async function loadAssetImage(source) {
  return loadAssetImageSource(loadImage, source);
}

function banner() {
  return (async () => {
    try {
      const img = await loadAssetImage(BANNER_PATH);
      const scale = Math.min((PANEL_W - 16) / img.width, ICON_MAX_H / img.height);
      const w = img.width * scale, h = img.height * scale;
      const canvas = createCanvas(PANEL_W, PANEL_H);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, (PANEL_W - w) / 2, (PANEL_H - h) / 2, w, h);
      return encodeCanvas(canvas);
    } catch { return null; }
  })();
}

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

const GOLD_DAYS = new Set([7, 14, 21, 28, 29, 30]);

/** §19 reward by monthly day position (1–30). Chest columns are whitelisted. */
function dailyReward(day) {
  const gold = GOLD_DAYS.has(day);
  let credux; let shards;
  if (day === 30) [credux, shards] = [1500000, 1000];
  else if (day === 29) [credux, shards] = [1000000, 750];
  else if (day === 28) [credux, shards] = [750000, 600];
  else if (day >= 22) [credux, shards] = [150000, 250];   // 22–27
  else if (day === 21) [credux, shards] = [600000, 500];
  else if (day >= 15) [credux, shards] = [100000, 200];   // 15–20
  else if (day === 14) [credux, shards] = [400000, 350];
  else if (day >= 8) [credux, shards] = [75000, 150];     // 8–13
  else if (day === 7) [credux, shards] = [250000, 250];
  else [credux, shards] = [50000, 100];                   // 1–6
  return {
    credux, shards,
    chestCol: gold ? 'gold_chest' : 'silver_chest',
    chestLabel: gold ? 'Gold Chest' : 'Silver Chest',
  };
}

/** Bonus chest earned by the newly reached consecutive streak, if any. */
function streakMilestone(streak) {
  if (streak === 15) {
    return { chestCol: 'boss_treasure_chest', chestLabel: 'Boss Treasure Chest' };
  }
  if (streak >= 30 && streak % 15 === 0) {
    return { chestCol: 'boss_golden_chest', chestLabel: 'Boss Golden Chest' };
  }
  return null;
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
  const milestone = streakMilestone(overall);
  const milestoneCol = milestone?.chestCol; // whitelisted literal
  const milestoneSet = milestoneCol ? `,\n            ${milestoneCol} = ${milestoneCol} + 1` : '';
  const milestoneReturning = milestoneCol ? `, ${milestoneCol} AS milestone_chest_count` : '';

  const bagUpd = await client.query(
    `UPDATE users_bag
        SET credux = credux + $2, belief_shards = belief_shards + $3, ${col} = ${col} + 1${milestoneSet},
            lifetime_credux_earned = lifetime_credux_earned + $2
      WHERE discord_id = $1
      RETURNING credux, belief_shards, ${col} AS chest_count${milestoneReturning}`,
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
  if (milestone) {
    await client.query(
      `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
       VALUES ($1, 'Daily', $2, $3, $4)`,
      [
        discordId, milestone.chestCol,
        Number(after.milestone_chest_count) - 1, Number(after.milestone_chest_count),
      ]
    );
  }

  return {
    status: 'ok', day: monthly, monthly, overall,
    credux: rw.credux, shards: rw.shards, chestLabel: rw.chestLabel,
    milestoneChestLabel: milestone?.chestLabel || null,
  };
}

/** CV2 reward card (§19 layout). */
async function buildDailyPayload(result, logContext = {}) {
  const creduxIcon = emojiForDisplay('Credux Coin', '💰');
  const shardIcon = emojiForDisplay('Belief Shards', '🔮');
  const chestIcon = emojiForDisplay(result.chestLabel, '🎁');
  const milestoneChestIcon = result.milestoneChestLabel
    ? emojiForDisplay(result.milestoneChestLabel, '🎁')
    : null;

  const container = new ContainerBuilder().setAccentColor(ACCENT);
  const files = [];
  if (await remoteAssetAvailable(BANNER_REL)) {
    // Zero-egress path: Discord fetches the banner straight from R2.
    container.addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL(getAssetUrl(BANNER_REL))));
  } else {
    const buf = await banner();
    if (buf) {
      const image = await makeOptimizedAttachment(buf, 'attendance', {
        logContext: {
          ...logContext,
          imageType: 'daily_banner',
        },
      });
      files.push(image.file);
      container.addMediaGalleryComponents((g) =>
        g.addItems((item) => item.setURL(image.url)));
    }
  }
  let attendanceRewards =
    `${creduxIcon} **+${result.credux.toLocaleString()}** Credux\n` +
    `${shardIcon} **+${result.shards}** Belief Shards\n` +
    `${chestIcon} **+1** ${result.chestLabel}`;
  if (result.milestoneChestLabel) {
    attendanceRewards += `\n${milestoneChestIcon} **+1** ${result.milestoneChestLabel}`;
  }
  const streakUnit = Number(result.overall) === 1 ? 'day' : 'days';

  container
    .addTextDisplayComponents((td) => td.setContent(`## 📅 Daily Attendance — Day ${result.day}`))
    .addTextDisplayComponents((td) => td.setContent(`-# Month: ${result.monthly} / 30 · Streak: ${result.overall} ${streakUnit}`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(attendanceRewards));

  container
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
  return reply(message, await buildDailyPayload(result, {
    system: 'daily',
    command: 'daily',
    guildId: message.guild?.id,
    userId: discordId,
  }));
}

module.exports = {
  execute,
  claimDaily,
  dailyReward,
  buildDailyPayload,
  banner,
};
