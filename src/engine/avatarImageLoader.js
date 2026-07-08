'use strict';

const { relativeAssetPath } = require('../utils/assets');
const { performanceLog } = require('../utils/runtimeLogs');

function safeAssetKey(source) {
  const key = relativeAssetPath(source || '').replace(/[?#].*$/, '');
  return key.length > 180 ? `...${key.slice(-177)}` : key;
}

function avatarImageSourceCandidates(source) {
  if (!source) return [];
  const s = String(source).replace(/\\/g, '/');
  const match = /^(.*)\.(png|jpe?g|webp)$/i.exec(s);
  if (!match) return [s];

  const exts = [match[2].toLowerCase(), 'webp', 'png', 'jpg', 'jpeg'];
  const bases = [match[1]];
  const folderStyle = /^(.*\/(?:skins\/)?avatars\/(?:male|female))\/([^/]+)\/([^/]+)$/i.exec(match[1]);
  if (folderStyle) {
    const [, prefix, classFolder, fileStem] = folderStyle;
    const styleOnly = /^(cyber|anime|webtoon)$/i.exec(fileStem);
    const stemStyle = new RegExp(`^${classFolder}_(cyber|anime|webtoon)$`, 'i').exec(fileStem);
    const style = (styleOnly?.[1] || stemStyle?.[1] || '').toLowerCase();
    if (style) {
      bases.push(`${prefix}/${classFolder}/${classFolder}_${style}`);
      if (classFolder.toLowerCase() === 'archer') bases.push(`${prefix}/${classFolder}/acher_${style}`);
    }
  }

  for (const base of [...bases]) {
    const withoutSkins = base.replace(/\/skins\/avatars\//i, '/avatars/');
    if (withoutSkins !== base) bases.push(withoutSkins);
    if (!/\/skins\/avatars\//i.test(base)) {
      const withSkins = base.replace(/\/avatars\//i, '/skins/avatars/');
      if (withSkins !== base) bases.push(withSkins);
    }
  }

  return [...new Set(bases.flatMap((base) => exts.map((ext) => `${base}.${ext}`)))];
}

async function loadAvatarAsset(loadImageSource, sources, logContext = {}) {
  const entries = (Array.isArray(sources) ? sources : [sources])
    .filter(Boolean)
    .map((entry) => (typeof entry === 'string'
      ? { path: entry, avatarSource: 'avatar' }
      : entry))
    .filter((entry) => entry.path);

  for (const entry of entries) {
    for (const candidate of avatarImageSourceCandidates(entry.path)) {
      const meta = {
        ...logContext,
        avatarSource: entry.avatarSource || 'avatar',
        assetKey: safeAssetKey(candidate),
      };
      try {
        const image = await loadImageSource(candidate);
        if (image) {
          performanceLog('avatar image load', { ...meta, loadStatus: 'success' });
          return image;
        }
      } catch (err) {
        performanceLog('avatar image load', {
          ...meta,
          loadStatus: 'failure',
          reason: err.message,
        });
      }
    }
  }

  performanceLog('avatar image load', {
    ...logContext,
    avatarSource: 'missing',
    loadStatus: 'missing',
    reason: 'no-avatar-asset-loaded',
  });
  return null;
}

module.exports = {
  avatarImageSourceCandidates,
  loadAvatarAsset,
  safeAssetKey,
};
