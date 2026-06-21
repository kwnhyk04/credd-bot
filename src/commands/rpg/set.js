'use strict';

/**
 * set.js — `crd set all skin default`.
 *
 * Resets every equipped cosmetic skin back to the default templates by clearing the player's
 * equipped_skins rows. After this the render pipeline falls back through skinResolver's
 * precedence (base set for active supporters → testers/ beta default → free-player
 * default_template art), so the player can re-equip their own skins whenever they like.
 *
 * Cosmetic-only: touches equipped_skins exclusively, never ownership/currency. Plain-text.
 */

const pool = require('../../db/pool');
const ent = require('../../engine/supporterEntitlements');

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

async function execute(message, { args }) {
  const a = args.map((s) => (s || '').toLowerCase());
  // Accept `set all skin default` (canonical) and the looser `set skin default` / `set default skin`.
  const wantsDefault = a.includes('default');
  const wantsSkin = a.includes('skin') || a.includes('skins');
  if (!wantsSkin || !wantsDefault) {
    return reply(message, 'Usage: `crd set all skin default` — reset all your skins to the default templates.');
  }

  const removed = await ent.clearAllEquipped(pool, message.author.id);
  if (removed === 0) {
    return reply(message, 'Your skins are already on the default templates. Equip one with `crd equip skin <name>`.');
  }
  return reply(message,
    `🧹 Reset **${removed}** skin slot${removed === 1 ? '' : 's'} to default. Re-equip anytime with \`crd equip skin <name>\` — see \`crd skin collection\`.`);
}

module.exports = { execute };
