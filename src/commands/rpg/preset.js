'use strict';

const pool = require('../../db/pool');
const { getActiveLoadout } = require('../../engine/loadout');

async function execute(message) {
  const loadout = await getActiveLoadout(pool, message.author.id);
  if (!loadout) {
    return message.reply({
      content: 'You don\'t have a character yet. Use `crd create character` to get started.',
      allowedMentions: { repliedUser: false },
    });
  }
  return message.reply({
    content: `You have ${loadout.preset_count} presets, currently equipped preset ${loadout.active_preset_slot}.`,
    allowedMentions: { repliedUser: false },
  });
}

module.exports = { execute };
