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

const CAT_WORD = { profile: 'profile', battle: 'battle', battle_result: 'battle result', summon: 'summon' };

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub !== 'skin') return reply(message, 'Usage: `crd use skin <skin_code>` — e.g. `crd use skin p1`.');
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
    `${skinEmojiByCode(skin.skin_code)} Equipped **${skin.display_name}** (\`${skin.skin_code}\`) as your ${CAT_WORD[skin.category]} skin.`);
}

module.exports = { execute };
