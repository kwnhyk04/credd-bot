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

/**
 * Return a shallow, per-section layout patch for an explicit skin variant.
 * This keeps R2-owned shared layouts reusable while allowing one variant to
 * correct its panel geometry without requiring another R2 JSON asset.
 */
function profileSkinLayoutOverrides(skinPath, kind) {
  if (!skinPath || !LAYOUT_SUFFIX[kind]) return null;

  try {
    const skinAssetKey = relativeAssetPath(skinPath).replace(/\\/g, '/').toLowerCase();
    const variant = TESTER_PROFILE_VARIANTS.find((entry) => (
      `skins/${entry.render_filename}`.toLowerCase() === skinAssetKey
    ));
    return variant?.[`${kind}_layout_overrides`] || null;
  } catch {
    return null;
  }
}

module.exports = { profileSkinLayoutPath, profileSkinLayoutOverrides };
