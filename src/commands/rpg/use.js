'use strict';

/**
 * use.js — `crd use skin <skin_code>` (Supporter-stage addendum2 §3). User-facing equip.
 * Category is inferred from the code's leading letter (p/b/r/s), so no category arg.
 * Verifies ownership (dev accounts own all, §4), then sets equipped_skins for that category
 * (clearing any override_path). Cosmetic-only. Plain-text replies.
 *
 * The raw `crd dev use ...` forms (directory/tester/founder overrides) remain for dev testing.
 */

const pool = require('../../db/pool');
const ent = require('../../engine/supporterEntitlements');
const { skinEmojiByCode } = require('../../engine/skinEmojis');
const { resolveBagItem, CHEST_IDS, RUNE_BAG_IDS } = require('../../config/crdBagItems');
const { emoji } = require('../../utils/emojis');

const CAT_WORD = { profile: 'profile', battle: 'battle', battle_result: 'battle result', summon: 'summon' };

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/**
 * [Genesis update S8] `crd use <id>` — consume a CRD Bag ITEM.
 * Resolution is against the CRD Bag Items registry ONLY: shop numeric ids,
 * chest codes, rune-bag ids, and unknown ids are rejected with distinct
 * messages. Effects apply BEFORE consumption; nothing is consumed on cancel
 * or failure (relics via openRelic's transaction; `cc` via the Change
 * Character confirm transaction in changeClass.js).
 */
async function useItem(message, args) {
  const idRaw = String(args[0] || '').trim();
  const id = idRaw.toLowerCase();

  if (!id) {
    return reply(message, 'Usage: `crd use <id>` — see `crd bag items` for usable item ids, or `crd use skin <code>` for skins.');
  }

  const item = resolveBagItem(id);
  if (!item) {
    if (/^\d+$/.test(id)) {
      return reply(message, `\`${idRaw}\` is a CRD Shop product id, not a usable item id — buy with \`crd shop buy ${idRaw}\`, then see \`crd bag items\`.`);
    }
    if (CHEST_IDS.includes(id)) {
      return reply(message, `\`${idRaw}\` is a chest — open it with \`crd open ${id}\`. Usable items are listed in \`crd bag items\`.`);
    }
    if (RUNE_BAG_IDS.includes(id)) {
      return reply(message, `\`${idRaw}\` is a rune bag — open it with \`crd open ${id}\`. Usable items are listed in \`crd bag items\`.`);
    }
    return reply(message, `Unknown item id \`${idRaw}\` — see \`crd bag items\` for usable items.`);
  }

  if (item.use === 'relicOpen') {
    // Relics use one at a time — same rule as `crd open sr|supr`.
    if (args[1] !== undefined) {
      return reply(message, `${item.name}s are used one at a time — just \`crd use ${item.id}\`.`);
    }
    // Delegate to the relic-open flow (open.js): ownership check, effect
    // (10-roll / forced-Supreme summon), and consumption are one atomic
    // transaction — the relic only leaves the bag on COMMIT.
    const { openRelic } = require('./open');
    return openRelic(message, item.id);
  }

  if (item.use === 'classChange') {
    // Ownership pre-check only — the item is consumed exclusively inside the
    // Change Character confirm transaction (never on cancel/timeout/failure).
    const { rows } = await pool.query(
      'SELECT change_class FROM users_bag WHERE discord_id = $1',
      [message.author.id]
    );
    const owned = Number(rows[0]?.change_class || 0);
    if (owned < 1) {
      return reply(message,
        `You don't own a ${emoji(item.emojiName)} **${item.name}** — buy one in \`crd shop\` (id 1).`);
    }
    const changeClass = require('./changeClass');
    return changeClass.start(message, owned);
  }

  return reply(message, `\`${idRaw}\` can't be used right now.`);
}

async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub !== 'skin') return useItem(message, args);
  const code = (args[1] || '').toLowerCase();
  if (!code) return reply(message, 'Usage: `crd use skin <skin_code>` — e.g. `crd use skin p1`.');

  const ownerId = message.author.id;
  if (code === 'default') {
    const removed = await ent.clearAllEquipped(pool, ownerId);
    return reply(message, removed
      ? `🧹 Reset **${removed}** skin slot${removed === 1 ? '' : 's'} to the default templates.`
      : 'Your skins are already on the default templates.');
  }

  const skin = await ent.getCatalogByCode(pool, code);
  if (!skin) return reply(message, `No skin with code \`${code}\`. See \`crd skin collection\`.`);

  if (!(await ent.ownsResolved(pool, ownerId, skin.cosmetic_id))) {
    return reply(message, `You don\'t own \`${code}\` yet — buy it with \`crd buy ${code}\`.`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ent.equipCosmeticTx(client, ownerId, skin.category, skin.cosmetic_id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[use skin]', err.message);
    return reply(message, 'Equip failed — nothing changed.');
  } finally {
    client.release();
  }
  return reply(message,
    `${skinEmojiByCode(skin.skin_code, skin.category, skin.cosmetic_key)} Equipped **${skin.display_name}** (\`${skin.skin_code}\`) as your ${CAT_WORD[skin.category]} skin.`);
}

module.exports = { execute, useItem };
