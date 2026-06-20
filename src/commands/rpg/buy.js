'use strict';

/**
 * buy.js — `crd buy <skin_code>` (Supporter-stage addendum2 §2). Supporters only.
 * Resolves the code → catalog row, enforces active-supporter + tier gate + not-owned +
 * enough tokens, then spends tokens and grants ownership (one atomic tx). Cosmetic-only —
 * tokens are isolated from credux. Category is implied by the code's leading letter.
 *
 * Plain-text replies only (project rule: no embeds on errors). The free dev variant is
 * `crd dev buy <code>`.
 */

const pool = require('../../db/pool');
const { TIER_RANK } = require('../../config/cosmetics');
const ent = require('../../engine/supporterEntitlements');
const { spendTokensTx } = require('../../engine/supporterTokens');
const { skinEmojiByCode, iconToken } = require('../../engine/skinEmojis');

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

async function execute(message, { args }) {
  const code = (args[0] || '').toLowerCase();
  if (!code) return reply(message, 'Usage: `crd buy <skin_code>` — e.g. `crd buy p1`.');

  const skin = await ent.getCatalogByCode(pool, code);
  if (!skin) return reply(message, `No skin with code \`${code}\`. See \`crd shop\`.`);
  if (skin.is_base) return reply(message, 'Base skins are granted free to supporters — nothing to buy.');

  const ownerId = message.author.id;
  const sup = await ent.getSupporter(pool, ownerId);
  const tier = ent.effectiveTier(sup);
  const dev = ent.isDevAccount(ownerId);
  if (!tier && !dev) return reply(message, 'The Supporter Shop is for active supporters. Subscribe first.');
  if (await ent.ownsResolved(pool, ownerId, skin.cosmetic_id)) {
    return reply(message, `You already own **${skin.display_name}** (\`${skin.skin_code}\`). Equip: \`crd use skin ${skin.skin_code}\`.`);
  }
  if (!dev && TIER_RANK[skin.tier] > TIER_RANK[tier]) {
    return reply(message, `**${skin.display_name}** is a higher-tier skin than your supporter tier allows.`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await spendTokensTx(client, ownerId, skin.token_cost, 'shop_buy', skin.skin_code);
    if (!res.ok) {
      await client.query('ROLLBACK');
      return reply(message, res.reason === 'insufficient'
        ? `Not enough tokens — **${skin.display_name}** costs ${skin.token_cost} ${iconToken()}, you have ${res.balance}.`
        : 'Unavailable.');
    }
    await ent.grantCosmeticTx(client, ownerId, skin.cosmetic_id, 'shop');
    await client.query('COMMIT');
    return reply(message,
      `${skinEmojiByCode(skin.skin_code)} Bought **${skin.display_name}** (\`${skin.skin_code}\`) for ${skin.token_cost} ${iconToken()}. ` +
      `Balance: **${res.balance}**. Equip: \`crd use skin ${skin.skin_code}\`.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[buy]', err.message);
    return reply(message, 'Purchase failed — nothing was spent.');
  } finally {
    client.release();
  }
}

module.exports = { execute };
