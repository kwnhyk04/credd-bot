'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS_ROOT = path.join(process.cwd(), 'assets');

function cleanAssetPath(relativePath) {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .replace(/^\/+/, '');
}

function assetBaseUrl() {
  const baseUrl = process.env.ASSET_BASE_URL;
  return baseUrl && baseUrl.trim() ? baseUrl.trim().replace(/\/+$/, '') : '';
}

function assetVersion() {
  const version = process.env.ASSET_VERSION;
  return version && version.trim() ? version.trim() : '';
}

function versionedAssetUrl(url) {
  const version = assetVersion();
  if (!version) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

function assetPath(relativePath) {
  const cleanPath = cleanAssetPath(relativePath);
  const baseUrl = assetBaseUrl();
  if (baseUrl) return versionedAssetUrl(`${baseUrl}/${cleanPath}`);
  return path.join(ASSETS_ROOT, ...cleanPath.split('/').filter(Boolean));
}

function localAssetPath(relativePath) {
  const cleanPath = cleanAssetPath(relativePath);
  return path.join(ASSETS_ROOT, ...cleanPath.split('/').filter(Boolean));
}

function isRemoteSource(source) {
  return /^https?:\/\//i.test(String(source || ''));
}

function isRemoteAssetsEnabled() {
  return Boolean(assetBaseUrl());
}

function relativeAssetPath(source) {
  const raw = String(source || '');
  if (!raw) return '';

  const normalized = raw.replace(/\\/g, '/');
  const baseUrl = assetBaseUrl();
  if (baseUrl && normalized.toLowerCase().startsWith(`${baseUrl.toLowerCase()}/`)) {
    return cleanAssetPath(normalized.slice(baseUrl.length + 1));
  }

  const abs = path.resolve(raw);
  const rel = path.relative(ASSETS_ROOT, abs);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return cleanAssetPath(rel);
  }

  if (normalized.startsWith('assets/')) return cleanAssetPath(normalized.slice('assets/'.length));
  return cleanAssetPath(normalized);
}

function assetFileName(source, fallback = 'asset') {
  const clean = String(source || '')
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '');
  const name = clean.split('/').filter(Boolean).pop() || fallback;
  return name.replace(/[^\w.-]/g, '_') || fallback;
}

function assetExtension(source, fallback = 'bin') {
  const name = assetFileName(source, '');
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : fallback;
}

function assetSource(source) {
  if (!source) return source;
  if (isRemoteSource(source)) return source;

  const raw = String(source);
  const rel = relativeAssetPath(raw);
  const abs = path.resolve(raw);
  const rawLooksAbsolute = path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw);
  const underAssets = rawLooksAbsolute && rel && !rel.startsWith('..');
  if (underAssets || !rawLooksAbsolute) return assetPath(rel);
  return raw;
}

async function fetchAssetBuffer(source) {
  const resolved = assetSource(source);
  if (isRemoteSource(resolved)) {
    try {
      const res = await fetch(resolved);
      if (!res.ok) throw new Error(`Asset fetch failed ${res.status}: ${resolved}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      const rel = relativeAssetPath(resolved);
      const fallback = rel ? localAssetPath(rel) : null;
      if (fallback) {
        try { return await fs.promises.readFile(fallback); } catch { /* throw original error */ }
      }
      throw err;
    }
  }
  return fs.promises.readFile(resolved);
}

async function attachmentSource(source) {
  const resolved = assetSource(source);
  return isRemoteSource(resolved) ? fetchAssetBuffer(resolved) : resolved;
}

async function readAssetText(source, encoding = 'utf8') {
  const buffer = await fetchAssetBuffer(source);
  return buffer.toString(encoding);
}

async function readAssetJson(source) {
  return JSON.parse(await readAssetText(source));
}

async function loadAssetImage(loadImageFn, source) {
  const resolved = assetSource(source);
  try {
    return await loadImageFn(resolved);
  } catch (err) {
    if (isRemoteSource(resolved)) {
      const rel = relativeAssetPath(resolved);
      const fallback = rel ? localAssetPath(rel) : null;
      if (fallback && fs.existsSync(fallback)) return loadImageFn(fallback);
    }
    throw err;
  }
}

async function assetExists(source) {
  const resolved = assetSource(source);
  if (isRemoteSource(resolved)) return true;
  try {
    await fs.promises.access(resolved, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function assetExistsSync(source) {
  const resolved = assetSource(source);
  if (isRemoteSource(resolved)) return true;
  try { return fs.existsSync(resolved); } catch { return false; }
}

function assetSignatureSync(source) {
  const resolved = assetSource(source);
  if (isRemoteSource(resolved)) return resolved;
  return fs.statSync(resolved).mtimeMs;
}

module.exports = {
  ASSETS_ROOT,
  assetPath,
  assetFileName,
  assetExtension,
  assetSource,
  assetVersion,
  localAssetPath,
  relativeAssetPath,
  fetchAssetBuffer,
  attachmentSource,
  readAssetText,
  readAssetJson,
  loadAssetImage,
  assetExists,
  assetExistsSync,
  assetSignatureSync,
  isRemoteSource,
  isRemoteAssetsEnabled,
};
