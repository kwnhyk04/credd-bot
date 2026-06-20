'use strict';

/**
 * shop.js — `crd shop` (Supporter-stage §5 + addendum2 §1). Active supporters open the
 * paginated, deity-collection-style skin shop (one category per page; ◀ ▶ + Preview).
 * Buying/equipping is via `crd buy <code>` / `crd use skin <code>`. Cosmetic-only.
 *
 * Non-supporters get a plain-text "subscribe to unlock" notice (no embed, per project rule).
 * The dev-bypass variant lives in `crd dev supporter shop`.
 */

const pool = require('../../db/pool');
const ent = require('../../engine/supporterEntitlements');
const { buildShopPage } = require('../../engine/skinShopViews');

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

async function execute(message) {
  const ownerId = message.author.id;
  const sup = await ent.getSupporter(pool, ownerId);
  if (!ent.effectiveTier(sup) && !ent.isDevAccount(ownerId)) {
    return reply(message, {
      content:
        '🛒 The Supporter Shop is for active supporters. Subscribe (Believer / Chosen) or become a ' +
        'Founder (Eternal) to unlock cosmetic skins + a monthly token stipend. Cosmetic only — no gameplay advantage. ' +
        'Browse art anytime with `crd skin collection`.',
    });
  }
  return reply(message, await buildShopPage(pool, ownerId, { page: 0, ctx: 'shop' }));
}

module.exports = { execute };
