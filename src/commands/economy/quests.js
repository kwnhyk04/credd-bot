'use strict';

/**
 * `crd quest` / `crd quests` — view today's DAILY quests or this week's WEEKLY quests
 * (Master §20, Phase 8 + Phase 6). A Daily/Weekly dropdown in the header switches the
 * board; the view lazily rolls that board first.
 *   `crd quest refresh <Q1|Q2|Q3>` — reroll one DAILY line (2 refreshes/player/day).
 *   `crd quest claim`               — claim the WEEKLY grand bundle once all 5 are done.
 *
 * Components V2 + canvas body, same boxed-row visual as `crd bag chests`.
 */

const {
  ContainerBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const {
  rollQuestsIfMissing, refreshQuestLine, getRefreshesUsed, describeQuest,
  hoursUntilMidnightPHT, REFRESH_ALLOWANCE,
  rollWeeklyIfMissing, describeWeekly, claimWeeklyGrand,
} = require('../../utils/questProgress');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { phtWeek } = require('../../config/ranked');
const { renderQuestRowsImage } = require('../../engine/renderQuestRows');

const ACCENT = 0xf0b232;

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

/** "q1"/"Q2"/"3" → 0-based index, or null. */
function parsePosition(token) {
  const m = /^q?([123])$/i.exec((token || '').trim());
  return m ? Number(m[1]) - 1 : null;
}

/** Daily/Weekly dropdown for the board header. */
function scopeRow(scope, ownerId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`quest:scope:${ownerId}`)
    .setPlaceholder('Daily / Weekly')
    .addOptions(
      { label: 'Daily Quests', value: 'daily', default: scope === 'daily' },
      { label: 'Weekly Quests', value: 'weekly', default: scope === 'weekly' },
    );
  return new ActionRowBuilder().addComponents(menu);
}

// ── DAILY ──────────────────────────────────────────────────────────────────
async function dailyPayload(ownerId, note) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await rollQuestsIfMissing(client, ownerId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[quests] daily roll failed:', err.message);
  } finally {
    client.release();
  }

  const { rows } = await pool.query(
    `SELECT quest_type, target_count, current_count, reward_credux, reward_belief_shards, completed
       FROM daily_quests
      WHERE discord_id = $1 AND quest_date = (NOW() AT TIME ZONE 'Asia/Manila')::date
      ORDER BY id`,
    [ownerId]
  );
  const quests = rows.map(describeQuest);
  if (quests.length === 0) return { content: 'No quests are available right now — try again in a moment.' };

  const refreshesUsed = await getRefreshesUsed(pool, ownerId);
  const refreshesLeft = Math.max(0, REFRESH_ALLOWANCE - refreshesUsed);
  const hours = hoursUntilMidnightPHT();
  const buffer = await renderQuestRowsImage(quests);
  const file = new AttachmentBuilder(buffer, { name: 'quests.png' });

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents((td) => td.setContent('## 📋 Daily Quests'));
  container.addActionRowComponents(() => scopeRow('daily', ownerId));
  if (note) container.addTextDisplayComponents((td) => td.setContent(`-# ${note}`));
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `-# ⏳ Resets in ${hours} hour${hours === 1 ? '' : 's'} · 🔄 ${refreshesLeft}/${REFRESH_ALLOWANCE} refreshes left · \`crd quest refresh <Q1|Q2|Q3>\``))
    .addMediaGalleryComponents((g) => g.addItems((item) => item.setURL('attachment://quests.png')))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# *"The gods reward those who prove their worth."*'));

  return { components: [container], files: [file], flags: MessageFlags.IsComponentsV2 };
}

// ── WEEKLY ─────────────────────────────────────────────────────────────────
async function weeklyPayload(ownerId, note) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await rollWeeklyIfMissing(client, ownerId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[quests] weekly roll failed:', err.message);
  } finally {
    client.release();
  }

  const week = phtWeek();
  const { rows } = await pool.query(
    `SELECT quest_type, target_count, current_count, reward_credux, reward_valor, completed
       FROM weekly_quests WHERE discord_id = $1 AND quest_week = $2 ORDER BY id`,
    [ownerId, week]
  );
  const quests = rows.map(describeWeekly);
  if (quests.length === 0) return { content: 'No weekly quests available right now — try again in a moment.' };

  const done = quests.filter((q) => q.completed).length;
  const allDone = done === quests.length;
  const grandRes = await pool.query(
    'SELECT claimed FROM weekly_grand WHERE discord_id = $1 AND quest_week = $2',
    [ownerId, week]
  );
  const claimed = grandRes.rows[0]?.claimed === true;

  // Reuse the quest-row renderer; map Valor into the shard slot + swap the icon.
  const rowItems = quests.map((q) => ({ ...q, rewardShards: q.rewardValor }));
  const buffer = await renderQuestRowsImage(rowItems, { rewardIcon: 'valor_medal' });
  const file = new AttachmentBuilder(buffer, { name: 'weekly.png' });

  const grandLine = claimed
    ? '-# 🏆 Grand reward claimed this week.'
    : allDone
      ? '-# 🏆 **All 5 complete!** Claim **1 Sacred Relic** + bonus with `crd quest claim`.'
      : `-# 🏆 Grand reward (1 Sacred Relic + bonus): **${done}/${quests.length}** complete.`;

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents((td) => td.setContent('## 🗓️ Weekly Quests'));
  container.addActionRowComponents(() => scopeRow('weekly', ownerId));
  if (note) container.addTextDisplayComponents((td) => td.setContent(`-# ${note}`));
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# Resets weekly (Mon, PHT). Rewards in Credux + Valor Medals.'))
    .addMediaGalleryComponents((g) => g.addItems((item) => item.setURL('attachment://weekly.png')))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(grandLine));

  const components = [container];
  if (allDone && !claimed) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`quest:claim:${ownerId}`).setLabel('🏆 Claim Grand Reward').setStyle(ButtonStyle.Success),
    ));
  }
  return { components, files: [file], flags: MessageFlags.IsComponentsV2 };
}

async function showQuests(message, note = null, scope = 'daily') {
  const payload = scope === 'weekly'
    ? await weeklyPayload(message.author.id, note)
    : await dailyPayload(message.author.id, note);
  return reply(message, payload);
}

/** Run the grand-reward claim txn and return a user-facing message string. */
async function runGrandClaim(discordId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [discordId]);
    const res = await claimWeeklyGrand(client, discordId);
    await client.query('COMMIT');
    if (res.status === 'incomplete') return `⚔️ Finish all 5 weekly quests first — **${res.done}/${res.total}** done.`;
    if (res.status === 'already') return '✅ You already claimed this week\'s grand reward.';
    return `🏆 Grand reward claimed: **${res.relics}× Sacred Relic** + **${res.valor} Valor** + **${res.credux.toLocaleString()} Credux**!`;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[quests] grand claim failed:', err.message);
    return 'Claim failed — nothing was granted.';
  } finally {
    client.release();
  }
}

async function handleRefresh(message, token, { bypassMax = false } = {}) {
  const index = parsePosition(token);
  if (index === null) return reply(message, { content: 'Usage: `crd quest refresh <Q1|Q2|Q3>`' });

  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    result = await refreshQuestLine(client, message.author.id, index, { bypassMax });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[quests] refresh failed:', err.message);
    return reply(message, { content: 'Refresh failed — nothing was changed.' });
  } finally {
    client.release();
  }

  if (result.status === 'max') return reply(message, { content: `You've used all ${result.allowance} quest refreshes today. They reset at midnight PHT.` });
  if (result.status === 'badindex') return reply(message, { content: 'No quest in that slot — pick `Q1`, `Q2`, or `Q3`.' });
  if (result.status !== 'ok') return reply(message, { content: 'Could not refresh that quest — try again.' });

  const tail = result.bypassed ? '(dev bypass — no refresh consumed)' : `${result.allowance - result.used}/${result.allowance} refreshes left`;
  return showQuests(message, `🔄 Refreshed **Q${result.position}** → ${result.newQuest.name} · ${tail}`, 'daily');
}

async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'refresh') return handleRefresh(message, args[1]);
  if (sub === 'claim') {
    const msg = await runGrandClaim(message.author.id);
    return reply(message, { content: msg });
  }
  const scope = (sub === 'weekly' || sub === 'w') ? 'weekly' : 'daily';
  return showQuests(message, null, scope);
}

/** Select: quest:scope:<owner> — switch Daily/Weekly board. */
async function handleScopeSelect(interaction) {
  const ownerId = interaction.customId.split(':')[2];
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Run `crd quest` yourself.', flags: MessageFlags.Ephemeral });
  }
  const scope = interaction.values[0] === 'weekly' ? 'weekly' : 'daily';
  await interaction.deferUpdate();
  try {
    const payload = scope === 'weekly'
      ? await weeklyPayload(ownerId, null)
      : await dailyPayload(ownerId, null);
    return interaction.editReply(payload);
  } catch (err) {
    console.error('[quests] scope component failed:', err.message);
    return interaction.followUp({
      content: 'Could not refresh your quest board. Try `crd quest` again.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/** Button: quest:claim:<owner> — claim the weekly grand reward, then refresh the board. */
async function handleClaimButton(interaction) {
  const ownerId = interaction.customId.split(':')[2];
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Run `crd quest` yourself.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  const msg = await runGrandClaim(ownerId);
  try {
    const payload = await weeklyPayload(ownerId, msg);
    return interaction.editReply(payload);
  } catch (err) {
    console.error('[quests] claim component refresh failed:', err.message);
    return interaction.followUp({
      content: `${msg}\nQuest board refresh failed. Run \`crd quest weekly\` to reload it.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { execute, showQuests, handleRefresh, handleScopeSelect, handleClaimButton };
