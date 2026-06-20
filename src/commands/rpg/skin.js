'use strict';

/**
 * skin.js — `crd skin collection` (Supporter-stage addendum2 §5). Open to EVERYONE
 * (supporter or not): paginated, deity-collection-style view of all skins by category,
 * with 🔒 for unowned, ✅/「Equipped」 markers, emoji icons, and the token balance.
 * Shares the renderer with the shop (ctx 'coll'). `crd skin list` is an alias.
 */

const pool = require('../../db/pool');
const { buildShopPage } = require('../../engine/skinShopViews');

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

async function execute(message, { args }) {
  const sub = (args[0] || 'collection').toLowerCase();
  if (sub !== 'collection' && sub !== 'list') {
    return reply(message, { content: 'Usage: `crd skin collection` — browse skins by category (`crd use skin <code>` to equip).' });
  }
  return reply(message, await buildShopPage(pool, message.author.id, { page: 0, ctx: 'coll' }));
}

module.exports = { execute };
