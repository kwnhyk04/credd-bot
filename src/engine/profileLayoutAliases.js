'use strict';

const { TESTER_PROFILE_VARIANTS } = require('../config/cosmetics');
const {
  assetPath,
  isRemoteSource,
  localAssetPath,
  relativeAssetPath,
} = require('../utils/assets');

const LAYOUT_SUFFIX = Object.freeze({
  profile: '.layout.json',
  stats: '.stats.layout.json',
});

const LAYOUT_SOURCE_BY_KIND = Object.freeze(Object.fromEntries(
  Object.keys(LAYOUT_SUFFIX).map((kind) => [
    kind,
    new Map(TESTER_PROFILE_VARIANTS.map((variant) => [
      `skins/${variant.render_filename}`.toLowerCase(),
      `skins/${variant[`${kind}_layout_source_filename`] || variant.layout_source_filename}`,
    ])),
  ])
));

function fallbackLayoutPath(skinPath, suffix) {
  return String(skinPath || '').replace(/\.[^./?#]+(?=([?#]|$))/, suffix);
}

/**
 * Resolve the managed layout JSON for a profile skin. Most skins use their own
 * sibling config; explicit tester variants may reuse another skin's config.
 */
function profileSkinLayoutPath(skinPath, kind) {
  const suffix = LAYOUT_SUFFIX[kind];
  if (!skinPath || !suffix) return null;

  try {
    const skinAssetKey = relativeAssetPath(skinPath).replace(/\\/g, '/');
    const layoutSource = LAYOUT_SOURCE_BY_KIND[kind].get(skinAssetKey.toLowerCase()) || skinAssetKey;
    const layoutAssetKey = layoutSource.replace(/\.[^./]+$/, suffix);
    return isRemoteSource(skinPath) ? assetPath(layoutAssetKey) : localAssetPath(layoutAssetKey);
  } catch {
    return fallbackLayoutPath(skinPath, suffix);
  }
}

module.exports = { profileSkinLayoutPath };
