'use strict';

/**
 * `crd cred` (alias `crd g`) — lightweight Credux balance check (Master §3).
 *
 * Unlike `crd bag` (which requires a created character), this works for ANY registered
 * account even WITHOUT a character — Credux can exist pre-character. So it is wired with
 * requiresCharacter:false. Reads `users_bag.credux`, which is created at registration
 * (register.js inserts the bag row at all-0 defaults), so the row exists pre-character.
 * Text-only (no canvas) — a single line with the credux icon before the amount.
 */

const pool = require('../../db/pool');
const { emoji } = require('../../utils/emojis');

async function execute(message) {
  let credux = 0;
  try {
    const { rows } = await pool.query('SELECT credux FROM users_bag WHERE discord_id = $1', [message.author.id]);
    if (rows.length) credux = Number(rows[0].credux);
  } catch (err) {
    console.error('[cred]', err.message);
    return message.reply({ content: 'Could not read your balance right now — try again.', allowedMentions: { repliedUser: false } });
  }
  const icon = emoji('credux_coin');
  return message.reply({
    content: `Your Credux balance: ${icon} **${credux.toLocaleString()}**`,
    allowedMentions: { repliedUser: false },
  });
}

module.exports = { execute };
