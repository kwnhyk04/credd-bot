'use strict';

const pool = require('../../db/pool');
const { unlockSocket } = require('./socket');

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
  const gearId = (args[0] || '').trim().toLowerCase();
  if (!gearId) {
    await reply(message, `Usage: \`crd ${verb} <id>\``);
    return;
  }

  const discordId = message.author.id;
  const icon = locked ? '🔒' : '🔓';
  const word = locked ? 'locked' : 'unlocked';

  // Weapon first.
  const w = await pool.query(
    `UPDATE user_weapons uw
        SET is_locked = $3
       FROM weapon_roster wr
      WHERE uw.weapon_roster_id = wr.weapon_roster_id
        AND uw.weapon_id = $1
        AND uw.discord_id = $2
      RETURNING wr.name, wr.tier, uw.enhancement`,
    [gearId, discordId, locked]
  );
  if (w.rows.length > 0) {
    const g = w.rows[0];
    await reply(message, `${icon} **${g.name}** (${g.tier}) +${g.enhancement - 1} is now ${word}.`);
    return;
  }

  // Then armor.
  const a = await pool.query(
    `UPDATE user_armors ua
        SET is_locked = $3
       FROM armor_roster ar
      WHERE ua.armor_roster_id = ar.armor_roster_id
        AND ua.armor_id = $1
        AND ua.discord_id = $2
      RETURNING ar.name, ar.tier, ar.type, ua.enhancement`,
    [gearId, discordId, locked]
  );
  if (a.rows.length > 0) {
    const g = a.rows[0];
    await reply(message, `${icon} **${g.name}** (${g.tier} ${g.type}) +${g.enhancement - 1} is now ${word}.`);
    return;
  }

  // Then rune (by rune_uid). Extends the lock convention to runes (§2.6).
  const r = await pool.query(
    `UPDATE user_runes ur
        SET is_locked = $3
       FROM rune_roster rn
      WHERE ur.rune_id = rn.rune_id
        AND ur.rune_uid = $1
        AND ur.discord_id = $2
      RETURNING rn.name, rn.tier`,
    [gearId, discordId, locked]
  );
  if (r.rows.length > 0) {
    const g = r.rows[0];
    await reply(message, `${icon} **${g.name}** rune (${g.tier}) is now ${word}.`);
    return;
  }

  await reply(message, 'You don\'t own equipment or a rune with that ID.');
}

const lock = (message, { args }) => setLock(message, args, true);
const unlock = (message, { args }) => {
  // `crd unlock socket <gear_id>` buys the next opposite slot (§2.5).
  if ((args[0] || '').toLowerCase() === 'socket') return unlockSocket(message, args);
  return setLock(message, args, false);
};

module.exports = { lock, unlock };
