'use strict';

const pool = require('../../db/pool');
const ent = require('../../engine/supporterEntitlements');
const { skinEmojiByCode } = require('../../engine/skinEmojis');

const CAT_WORD = { profile: 'profile', battle: 'battle', battle_result: 'battle result', summon: 'summon' };

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/**
 * `crd equip skin <skin_name|code>` — equip a cosmetic skin the player owns (by display name,
 * skin code, or exact key). Category is taken from the resolved catalog row. Cosmetic-only.
 */
async function equipSkin(message, args) {
  const ref = args.slice(1).join(' ').trim();
  if (!ref) {
    return reply(message, 'Usage: `crd equip skin <skin_name>` — e.g. `crd equip skin Divine Radiance` or `crd equip skin p1`.');
  }
  const ownerId = message.author.id;
  if (ref.toLowerCase() === 'default') {
    const removed = await ent.clearAllEquipped(pool, ownerId);
    return reply(message, removed
      ? `🧹 Reset **${removed}** skin slot${removed === 1 ? '' : 's'} to the default templates.`
      : 'Your skins are already on the default templates.');
  }
  const skin = await ent.resolveCatalogRef(pool, ownerId, ref);
  if (!skin) return reply(message, `No skin matches \`${ref}\`. See \`crd skin collection\`.`);
  if (!(await ent.ownsResolved(pool, ownerId, skin.cosmetic_id))) {
    const how = skin.skin_code ? `buy it with \`crd buy ${skin.skin_code}\`` : 'it isn\'t available to you';
    return reply(message, `You don't own **${skin.display_name}** yet — ${how}.`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ent.equipCosmeticTx(client, ownerId, skin.category, skin.cosmetic_id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[equip skin]', err.message);
    return reply(message, 'Equip failed — nothing changed.');
  } finally {
    client.release();
  }
  const codeTxt = skin.skin_code ? ` (\`${skin.skin_code}\`)` : '';
  return reply(message,
    `${skinEmojiByCode(skin.skin_code)} Equipped **${skin.display_name}**${codeTxt} as your ${CAT_WORD[skin.category]} skin.`);
}

/**
 * `crd equip <weapon_id>` — equip a weapon the player owns.
 * `crd equip skin <skin_name>` — equip a cosmetic skin (delegates to equipSkin).
 */
async function execute(message, { args }) {
  if ((args[0] || '').toLowerCase() === 'skin') return equipSkin(message, args);

  const weaponId = (args[0] || '').trim().toLowerCase();
  if (!weaponId) {
    await reply(message, 'Usage: `crd equip <weapon_id>`');
    return;
  }

  const discordId = message.author.id;
  const { rows } = await pool.query(
    `SELECT wr.name, wr.tier, uw.enhancement
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
      WHERE uw.weapon_id = $1 AND uw.discord_id = $2`,
    [weaponId, discordId]
  );
  if (rows.length === 0) {
    await reply(message, 'You don\'t own a weapon with that ID.');
    return;
  }

  await pool.query(
    'UPDATE user_character SET equipped_weapon_id = $1 WHERE discord_id = $2',
    [weaponId, discordId]
  );

  const w = rows[0];
  await reply(message, `Equipped **${w.name}** (${w.tier}) +${w.enhancement - 1}.`);
}

module.exports = { execute };
