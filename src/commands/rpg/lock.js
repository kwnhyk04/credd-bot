'use strict';

const pool = require('../../db/pool');

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/**
 * Shared body for `crd lock` / `crd unlock` (Master §22).
 * Sets user_weapons.is_locked = `locked`. Locked weapons are excluded from
 * every `crd sell`. No currency movement → a single UPDATE is sufficient
 * (no transaction needed). Owner-scoped by discord_id.
 */
async function setLock(message, args, locked) {
  const verb = locked ? 'lock' : 'unlock';
  const weaponId = (args[0] || '').trim().toLowerCase();
  if (!weaponId) {
    await reply(message, `Usage: \`crd ${verb} <weapon_id>\``);
    return;
  }

  const discordId = message.author.id;
  const { rows } = await pool.query(
    `UPDATE user_weapons uw
        SET is_locked = $3
       FROM weapon_roster wr
      WHERE uw.weapon_roster_id = wr.weapon_roster_id
        AND uw.weapon_id = $1
        AND uw.discord_id = $2
      RETURNING wr.name, wr.tier, uw.enhancement`,
    [weaponId, discordId, locked]
  );

  if (rows.length === 0) {
    await reply(message, 'You don\'t own a weapon with that ID.');
    return;
  }

  const w = rows[0];
  const icon = locked ? '🔒' : '🔓';
  await reply(
    message,
    `${icon} **${w.name}** (${w.tier}) +${w.enhancement - 1} is now ${locked ? 'locked' : 'unlocked'}.`
  );
}

const lock = (message, { args }) => setLock(message, args, true);
const unlock = (message, { args }) => setLock(message, args, false);

module.exports = { lock, unlock };
