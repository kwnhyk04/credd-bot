'use strict';

const {
  isRemoteAssetsEnabled,
  remoteAssetAvailable,
  assetPath,
  assetExistsSync,
} = require('../utils/assets');
const { getSupporter, effectiveTier } = require('./supporterEntitlements');
const { SUPPORTER_BADGE_DIR, SUPPORTER_BADGE_FILE } = require('../config/cosmetics');

/**
 * Resolve the active supporter's badge without making a HEAD response a render gate.
 * The renderer performs the real image GET and already treats a missing asset as optional.
 */
async function resolveSupporterBadge(db, discordId) {
  const tier = effectiveTier(await getSupporter(db, discordId));
  const file = SUPPORTER_BADGE_FILE[tier];
  if (!tier || !file) return { path: null, available: false };

  const relativePath = `${SUPPORTER_BADGE_DIR}/${file}.png`;
  const path = assetPath(relativePath);
  const available = isRemoteAssetsEnabled()
    ? await remoteAssetAvailable(relativePath)
    : assetExistsSync(path);

  // `available` is advisory for cache invalidation only. Keep the path even when
  // HEAD fails so the renderer can attempt the actual GET.
  return { path, available };
}

module.exports = { resolveSupporterBadge };
