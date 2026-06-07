'use strict';

const pool = require('../../db/pool');

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/**
 * `crd equip <weapon_id>` — equip a weapon the player owns.
 */
async function execute(message, { args }) {
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
