'use strict';

/**
 * `crd class passives` — compact reference for every playable class.
 *
 * Passive copy comes from config/classes, the same source used by character
 * creation/change previews and battle constants. Class icons resolve through
 * game_items.txt and fall back to the existing Unicode class symbols if a
 * registry entry is unavailable.
 */

const { ContainerBuilder, MessageFlags } = require('discord.js');
const { CLASS_NAMES, CLASSES } = require('../../config/classes');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emojiForDisplay } = require('../../utils/emojis');

const BRAND = 0xf0b232;

function buildClassPassives() {
  const body = CLASS_NAMES.map((name) => {
    const cls = CLASSES[name];
    const icon = emojiForDisplay(name, cls.emoji);
    return `### ${icon} ${name}\n${cls.passiveLine}`;
  }).join('\n\n');

  const container = new ContainerBuilder().setAccentColor(BRAND);
  container.addTextDisplayComponents((td) => td.setContent('## Class Passives'));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(body));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

async function execute(message, { args = [] } = {}) {
  if (String(args[0] || '').toLowerCase() !== 'passives') {
    return message.reply({
      content: 'Usage: `crd class passives`',
      allowedMentions: { repliedUser: false },
    });
  }
  return message.reply({
    ...buildClassPassives(),
    allowedMentions: { repliedUser: false, parse: [] },
  });
}

module.exports = { execute, buildClassPassives };
