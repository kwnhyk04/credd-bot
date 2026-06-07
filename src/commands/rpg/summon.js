'use strict';

const { EmbedBuilder } = require('discord.js');
const pool = require('../../db/pool');
const { runSummon } = require('../../engine/summonEngine');
const {
  SHARDS_PER_PULL,
  ALLOWED_SUMMON_COUNTS,
  TIER_ALIAS,
  TIER_COLOR,
  TIER_RANK,
} = require('../../config/gachaRates');

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

/**
 * `crd summon [1|5|10]` / `crd s` — deity gacha, spends Belief Shards.
 * All-or-nothing: the full count × 100 shards must be available.
 */
async function execute(message, { args }) {
  const raw = (args[0] ?? '1').trim();
  if (!/^\d+$/.test(raw)) {
    await reply(message, { content: 'Usage: `crd summon [1|5|10]`' });
    return;
  }
  const count = parseInt(raw, 10);
  if (!ALLOWED_SUMMON_COUNTS.includes(count)) {
    await reply(message, { content: `You can summon ${ALLOWED_SUMMON_COUNTS.join(', ')} at a time — e.g. \`crd summon 10\`.` });
    return;
  }

  const cost = count * SHARDS_PER_PULL;
  const discordId = message.author.id;

  const client = await pool.connect();
  let result, shardsRemaining, sacredRelics;
  try {
    await client.query('BEGIN');

    const bagRes = await client.query(
      'SELECT belief_shards, sacred_relics FROM users_bag WHERE discord_id = $1 FOR UPDATE',
      [discordId]
    );
    if (bagRes.rows.length === 0) {
      await client.query('ROLLBACK');
      await reply(message, { content: 'You don\'t have a bag yet. Use `crd register` first.' });
      return;
    }
    const shardsBefore = bagRes.rows[0].belief_shards;
    sacredRelics = bagRes.rows[0].sacred_relics;
    if (shardsBefore < cost) {
      await client.query('ROLLBACK');
      await reply(message, { content: `You need **${cost.toLocaleString()}** Belief Shards for ${count} summon${count > 1 ? 's' : ''} — you have **${shardsBefore.toLocaleString()}**.` });
      return;
    }

    // Deduct the spend currency (the engine never touches belief_shards).
    await client.query(
      'UPDATE users_bag SET belief_shards = belief_shards - $2 WHERE discord_id = $1',
      [discordId, cost]
    );
    shardsRemaining = shardsBefore - cost;

    result = await runSummon(client, discordId, {
      count,
      log: { shardsStart: shardsBefore, shardsPerPull: SHARDS_PER_PULL },
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[summon] transaction failed:', err.message);
    await reply(message, { content: 'Something went wrong with your summon. No Belief Shards were spent.' });
    return;
  } finally {
    client.release();
  }

  await reply(message, {
    embeds: [buildResultEmbed(message, result, { count, shardsRemaining, sacredRelics })],
  });
}

/** Build the static results embed (no animation — hard constraint). */
function buildResultEmbed(message, result, { count, shardsRemaining, sacredRelics }) {
  const { pulls, summary, newActiveDeityId } = result;

  const highest = pulls.reduce(
    (h, p) => (TIER_RANK[p.tier] > TIER_RANK[h] ? p.tier : h),
    'Epic'
  );

  const lines = pulls.map((p) => {
    const star = p.isDupe ? '↻ +1 essence' : '✨ NEW';
    return `**${p.name}** — ${TIER_ALIAS[p.tier]} *(${p.tier})* · ${p.mythology} · ${star}`;
  });

  // Summary line, highest → lowest, only non-zero tiers.
  const summaryLine = ['Supreme', 'Legendary', 'Mythic', 'Epic']
    .filter((t) => summary[t] > 0)
    .map((t) => `${TIER_ALIAS[t]} ×${summary[t]}`)
    .join(' · ');

  const embed = new EmbedBuilder()
    .setColor(TIER_COLOR[highest])
    .setTitle(`Invocation — ${count} Summon${count > 1 ? 's' : ''}`)
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Summary', value: summaryLine || '—', inline: false })
    .setFooter({ text: `Belief Shards: ${shardsRemaining.toLocaleString()} · Sacred Relic: ${sacredRelics}` });

  if (newActiveDeityId != null) {
    embed.addFields({ name: 'Active Deity', value: 'Your first deity is now equipped.', inline: false });
  }

  return embed;
}

module.exports = { execute };
