'use strict';

/**
 * `crd weapon info <id>` — DEPRECATED alias of `crd equipment info <id>` ([v5]).
 * The unified weapon+armor info card lives in equipment.js; this thin shim keeps
 * the old command (and the `wi` alias) working. Prefer `crd equipment info`.
 */

const equipment = require('./equipment');

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'info') return equipment.info(message, (args[1] || '').trim());
  await reply(message, { content: 'Usage: `crd equipment info <id>` (or `crd weapon info <id>`)' });
}

module.exports = { execute };
