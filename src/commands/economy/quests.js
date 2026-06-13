'use strict';

/**
 * `crd quest` / `crd quests` — view today's 3 daily quests (Master §20, Phase 8).
 * `crd quest refresh <Q1|Q2|Q3>` — reroll one quest line (2 refreshes/player/day).
 *
 * Components V2 + canvas body: header → separator → "Resets in X hours" → MediaGallery
 * quest render (per-type icon, Q# label, progress bar, reward, status) → separator →
 * lore footer. Reading the view lazily rolls the day's quests first.
 */

const {
  ContainerBuilder, SeparatorSpacingSize, MediaGalleryBuilder, AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const {
  rollQuestsIfMissing, refreshQuestLine, getRefreshesUsed, describeQuest,
  hoursUntilMidnightPHT, REFRESH_ALLOWANCE,
} = require('../../utils/questProgress');
const { renderQuestRowsImage } = require('../../engine/renderQuestRows');

const ACCENT = 0xf0b232;
const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

/** "q1"/"Q2"/"3" → 0-based index, or null. */
function parsePosition(token) {
  const m = /^q?([123])$/i.exec((token || '').trim());
  return m ? Number(m[1]) - 1 : null;
}

/**
 * Render and send the quest board. `note` (optional) is shown as a -# line under the
 * header (e.g. a refresh confirmation). Lazily rolls quests if none exist yet.
 */
async function showQuests(message, note = null) {
  const discordId = message.author.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await rollQuestsIfMissing(client, discordId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[quests] roll failed:', err.message);
  } finally {
    client.release();
  }

  let quests; let refreshesUsed = 0;
  try {
    const { rows } = await pool.query(
      `SELECT quest_type, target_count, current_count, reward_credux, reward_belief_shards, completed
         FROM daily_quests
        WHERE discord_id = $1 AND quest_date = (NOW() AT TIME ZONE 'Asia/Manila')::date
        ORDER BY id`,
      [discordId]
    );
    quests = rows.map(describeQuest);
    refreshesUsed = await getRefreshesUsed(pool, discordId);
  } catch (err) {
    console.error('[quests] read failed:', err.message);
    return reply(message, { content: 'Could not load your quests right now — try again.' });
  }

  if (quests.length === 0) {
    return reply(message, { content: 'No quests are available right now — try again in a moment.' });
  }

  let buffer;
  try {
    buffer = await renderQuestRowsImage(quests);
  } catch (err) {
    console.error('[quests] render failed:', err.message);
    return reply(message, { content: 'Could not render your quests right now — try again.' });
  }
  const file = new AttachmentBuilder(buffer, { name: 'quests.png' });

  const hours = hoursUntilMidnightPHT();
  const refreshesLeft = Math.max(0, REFRESH_ALLOWANCE - refreshesUsed);

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents((td) => td.setContent('## 📋 Daily Quests'));
  if (note) container.addTextDisplayComponents((td) => td.setContent(`-# ${note}`));
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(`-# ⏳ Resets in ${hours} hour${hours === 1 ? '' : 's'} · 🔄 ${refreshesLeft}/${REFRESH_ALLOWANCE} refreshes left · \`crd quest refresh <Q1|Q2|Q3>\``))
    .addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL('attachment://quests.png'))
    )
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# *"The gods reward those who prove their worth."*'));

  return reply(message, {
    components: [container],
    files: [file],
    flags: MessageFlags.IsComponentsV2,
  });
}

/**
 * Refresh one quest line. bypassMax (dev) skips the 2/day cap. On success the board is
 * re-rendered with a confirmation note.
 */
async function handleRefresh(message, token, { bypassMax = false } = {}) {
  const index = parsePosition(token);
  if (index === null) {
    return reply(message, { content: 'Usage: `crd quest refresh <Q1|Q2|Q3>`' });
  }

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

  if (result.status === 'max') {
    return reply(message, {
      content: `You've used all ${result.allowance} quest refreshes today. They reset at midnight PHT.`,
    });
  }
  if (result.status === 'badindex') {
    return reply(message, { content: 'No quest in that slot — pick `Q1`, `Q2`, or `Q3`.' });
  }
  if (result.status !== 'ok') {
    return reply(message, { content: 'Could not refresh that quest — try again.' });
  }

  const tail = result.bypassed
    ? '(dev bypass — no refresh consumed)'
    : `${result.allowance - result.used}/${result.allowance} refreshes left`;
  return showQuests(message, `🔄 Refreshed **Q${result.position}** → ${result.newQuest.name} · ${tail}`);
}

async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'refresh') return handleRefresh(message, args[1]);
  return showQuests(message);
}

module.exports = { execute, showQuests, handleRefresh };
