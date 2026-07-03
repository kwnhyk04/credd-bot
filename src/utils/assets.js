'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS_ROOT = path.join(process.cwd(), 'assets');
const CACHE_MAX_ENTRIES = Math.max(1, Number(process.env.ASSET_CACHE_MAX_ENTRIES || 256));
const CACHE_MAX_BYTES = Math.max(1024 * 1024, Number(process.env.ASSET_CACHE_MAX_MB || 128) * 1024 * 1024);
const CACHE_TTL_MS = Math.max(0, Number(process.env.ASSET_CACHE_TTL_MS || 0));

const bufferCache = new Map();
const imageCache = new Map();
let cacheBytes = 0;
const cacheStats = {
  bufferHits: 0,
  bufferMisses: 0,
  imageHits: 0,
  imageMisses: 0,
  evictions: 0,
};

function cacheEntryCount() {
  return bufferCache.size + imageCache.size;
}

function estimateImageBytes(image) {
  const w = Number(image?.width) || 0;
  const h = Number(image?.height) || 0;
  return Math.max(1, w * h * 4);
}

function cacheGet(cache, key, hitStat) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (CACHE_TTL_MS && Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    cacheBytes -= entry.size;
    return null;
  }
  cacheStats[hitStat] += 1;
  entry.lastUsed = Date.now();
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function oldestEntry() {
  const b = bufferCache.entries().next().value;
  const i = imageCache.entries().next().value;
  if (!b) return i ? { cache: imageCache, key: i[0], entry: i[1] } : null;
  if (!i) return { cache: bufferCache, key: b[0], entry: b[1] };
  return b[1].lastUsed <= i[1].lastUsed
    ? { cache: bufferCache, key: b[0], entry: b[1] }
    : { cache: imageCache, key: i[0], entry: i[1] };
}

function trimCache() {
  while (cacheBytes > CACHE_MAX_BYTES || cacheEntryCount() > CACHE_MAX_ENTRIES) {
    const old = oldestEntry();
    if (!old) break;
    old.cache.delete(old.key);
    cacheBytes -= old.entry.size;
    cacheStats.evictions += 1;
  }
}

function cacheSet(cache, key, value, size) {
  if (!value || size > CACHE_MAX_BYTES) return value;
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cacheBytes -= existing.size;
  }
  const now = Date.now();
  cache.set(key, { value, size, createdAt: now, lastUsed: now });
  cacheBytes += size;
  trimCache();
  return value;
}

function clearAssetCache() {
  bufferCache.clear();
  imageCache.clear();
  cacheBytes = 0;
}

function getAssetCacheStats() {
  return {
    ...cacheStats,
    bufferEntries: bufferCache.size,
    imageEntries: imageCache.size,
    entries: cacheEntryCount(),
    bytes: cacheBytes,
    maxEntries: CACHE_MAX_ENTRIES,
    maxBytes: CACHE_MAX_BYTES,
    ttlMs: CACHE_TTL_MS,
  };
}

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

function getAssetUrl(relativePath) {
  const baseUrl = assetBaseUrl();
  if (!baseUrl) throw new Error('ASSET_BASE_URL is missing');
  return versionedAssetUrl(`${baseUrl}/${cleanAssetPath(relativePath)}`);
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
  const cached = cacheGet(bufferCache, resolved, 'bufferHits');
  if (cached) return cached;
  cacheStats.bufferMisses += 1;

  if (isRemoteSource(resolved)) {
    try {
      const res = await fetch(resolved);
      if (!res.ok) throw new Error(`Asset fetch failed ${res.status}: ${resolved}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return cacheSet(bufferCache, resolved, buffer, buffer.length);
    } catch (err) {
      const rel = relativeAssetPath(resolved);
      const fallback = rel ? localAssetPath(rel) : null;
      if (fallback) {
        try {
          const buffer = await fs.promises.readFile(fallback);
          return cacheSet(bufferCache, resolved, buffer, buffer.length);
        } catch { /* throw original error */ }
      }
      throw err;
    }
  }
  const buffer = await fs.promises.readFile(resolved);
  return cacheSet(bufferCache, resolved, buffer, buffer.length);
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
  const cached = cacheGet(imageCache, resolved, 'imageHits');
  if (cached) return cached;
  cacheStats.imageMisses += 1;

  try {
    const image = isRemoteSource(resolved)
      ? await loadImageFn(await fetchAssetBuffer(resolved))
      : await loadImageFn(resolved);
    return cacheSet(imageCache, resolved, image, estimateImageBytes(image));
  } catch (err) {
    if (isRemoteSource(resolved)) {
      const rel = relativeAssetPath(resolved);
      const fallback = rel ? localAssetPath(rel) : null;
      if (fallback && fs.existsSync(fallback)) {
        const image = await loadImageFn(fallback);
        return cacheSet(imageCache, resolved, image, estimateImageBytes(image));
      }
    }
    throw err;
  }
}

const loadCachedBuffer = fetchAssetBuffer;
async function loadCachedImage(loadImageFnOrSource, maybeSource) {
  if (typeof loadImageFnOrSource === 'function') {
    return loadAssetImage(loadImageFnOrSource, maybeSource);
  }
  const { loadImage } = require('@napi-rs/canvas');
  return loadAssetImage(loadImage, loadImageFnOrSource);
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
  getAssetUrl,
  assetFileName,
  assetExtension,
  assetSource,
  assetVersion,
  localAssetPath,
  relativeAssetPath,
  fetchAssetBuffer,
  loadCachedBuffer,
  attachmentSource,
  readAssetText,
  readAssetJson,
  loadAssetImage,
  loadCachedImage,
  assetExists,
  assetExistsSync,
  assetSignatureSync,
  clearAssetCache,
  getAssetCacheStats,
  isRemoteSource,
  isRemoteAssetsEnabled,
};
