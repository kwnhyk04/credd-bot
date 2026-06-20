'use strict';

const pool = require('../../db/pool');
const { runSummon } = require('../../engine/summonEngine');
const { buildFlipMessage, buildResultMessage, flipGifExists } = require('../../engine/renderSummon');
const {
  SHARDS_PER_PULL,
  ALLOWED_SUMMON_COUNTS,
  TIER_ALIAS,
} = require('../../config/gachaRates');

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // ── Display layer (renderSummon, Components V2) — pulls are already committed.
  // Two-phase: flip GIF suspense → edit to the rendered card-grid results.
  // rarity must be the display alias ('Remnant'|'Awakened'|'Undying'|'Primordial').
  const results = result.pulls.map((p) => ({
    name: p.name,
    rarity: TIER_ALIAS[p.tier],
    isNew: !p.isDupe,
    essence: p.essence,
  }));
  const balances = { beliefShards: shardsRemaining, sacredRelics };

  let sent = null;
  try {
    if (flipGifExists()) {
      sent = await reply(message, buildFlipMessage());
      await sleep(2000);
      // attachments: [] drops the flip GIF from the edited message.
      await sent.edit({ ...(await buildResultMessage(results, balances)), attachments: [] });
    } else {
      // card_flip.gif not on disk — skip the suspense phase.
      await reply(message, await buildResultMessage(results, balances));
    }
  } catch (err) {
    // Display-only failure: the pulls are committed — always tell the player.
    console.error('[summon] display failed:', err.message);
    if (sent) await sent.delete().catch(() => {});
    const lines = result.pulls.map((p) =>
      `${p.name} — ${TIER_ALIAS[p.tier]}${p.isDupe ? ` (+${p.essence} essence)` : ' (NEW)'}`
    );
    await message.reply({
      content: `✨ Invocation complete:\n${lines.join('\n')}\nBelief Shards: ${shardsRemaining.toLocaleString()}`,
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
  }
}

module.exports = { execute };
