'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  envBool, envNumber, envPositiveInt, bandwidthLog,
} = require('./runtimeLogs');
const { registerMemorySource } = require('./memoryRegistry');

const ASSETS_ROOT = path.join(process.cwd(), 'assets');
const DISK_CACHE_ROOT = path.join(process.cwd(), '.cache', 'assets');
const CACHE_MAX_ENTRIES = envPositiveInt(
  'ASSET_MEMORY_CACHE_MAX',
  envPositiveInt('ASSET_CACHE_MAX_ENTRIES', 256, { max: 5000 }),
  { max: 5000 }
);
const CACHE_MAX_BYTES = Math.max(
  1024 * 1024,
  envNumber(
    'ASSET_MEMORY_CACHE_MAX_MB',
    envNumber('ASSET_CACHE_MAX_MB', 40, { min: 40, max: 2048 }),
    { min: 40, max: 2048 }
  ) * 1024 * 1024
);
const CACHE_TTL_MS = Math.max(0, envNumber('ASSET_CACHE_TTL_MS', 30 * 60_000, { min: 0 }));

const bufferCache = new Map();
const imageCache = new Map();
const bufferInflight = new Map();
const imageInflight = new Map();
let cacheBytes = 0;
const cacheStats = {
  bufferHits: 0,
  bufferMisses: 0,
  imageHits: 0,
  imageMisses: 0,
  diskHits: 0,
  diskMisses: 0,
  downloadedBytes: 0,
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

function cacheDelete(cache, key) {
  const entry = cache.get(key);
  if (!entry) return false;
  cache.delete(key);
  cacheBytes = Math.max(0, cacheBytes - entry.size);
  return true;
}

function clearAssetCache() {
  bufferCache.clear();
  imageCache.clear();
  cacheBytes = 0;
}

function sweepExpiredAssetCache(now = Date.now()) {
  if (!CACHE_TTL_MS) return 0;
  let removed = 0;
  for (const cache of [bufferCache, imageCache]) {
    for (const [key, entry] of cache) {
      if (now - entry.createdAt <= CACHE_TTL_MS) continue;
      cache.delete(key);
      cacheBytes = Math.max(0, cacheBytes - entry.size);
      removed += 1;
    }
  }
  return removed;
}

function getAssetCacheStats() {
  sweepExpiredAssetCache();
  return {
    ...cacheStats,
    bufferEntries: bufferCache.size,
    imageEntries: imageCache.size,
    entries: cacheEntryCount(),
    bytes: cacheBytes,
    maxEntries: CACHE_MAX_ENTRIES,
    maxBytes: CACHE_MAX_BYTES,
    ttlMs: CACHE_TTL_MS,
    diskEnabled: diskCacheEnabled(),
    diskRoot: DISK_CACHE_ROOT,
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

function diskCacheEnabled() {
  return envBool('ASSET_DISK_CACHE_ENABLED', false);
}

function diskCacheIdentity(source) {
  const raw = String(source || '');
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}\n${assetVersion()}`;
  } catch {
    return raw.replace(/[?#].*$/, '');
  }
}

function diskCachePath(source) {
  const id = diskCacheIdentity(source);
  const hash = crypto.createHash('sha256').update(id).digest('hex');
  const ext = assetExtension(String(source || '').replace(/[?#].*$/, ''), 'bin');
  return path.join(DISK_CACHE_ROOT, `${hash}.${ext}`);
}

async function readDiskCache(source) {
  if (!diskCacheEnabled()) return null;
  const file = diskCachePath(source);
  try {
    const buffer = await fs.promises.readFile(file);
    cacheStats.diskHits += 1;
    return buffer;
  } catch {
    cacheStats.diskMisses += 1;
    return null;
  }
}

async function writeDiskCache(source, buffer) {
  if (!diskCacheEnabled() || !Buffer.isBuffer(buffer)) return;
  const file = diskCachePath(source);
  try {
    await fs.promises.mkdir(DISK_CACHE_ROOT, { recursive: true });
    await fs.promises.writeFile(file, buffer);
  } catch {
    // Disk cache is opportunistic; memory cache and fetch fallback remain authoritative.
  }
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

async function fetchUncachedAssetBuffer(resolved) {
  if (isRemoteSource(resolved)) {
    const disk = await readDiskCache(resolved);
    if (disk) return cacheSet(bufferCache, resolved, disk, disk.length);
    try {
      const res = await fetch(resolved);
      if (!res.ok) throw new Error(`Asset fetch failed ${res.status}: ${resolved}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      cacheStats.downloadedBytes += buffer.length;
      bandwidthLog('remote asset downloaded', {
        system: 'assets',
        cache: 'remote',
        name: assetFileName(resolved, 'asset'),
        bytes: buffer.length,
      });
      await writeDiskCache(resolved, buffer);
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

async function fetchAssetBuffer(source) {
  const resolved = assetSource(source);
  const cached = cacheGet(bufferCache, resolved, 'bufferHits');
  if (cached) return cached;
  const pending = bufferInflight.get(resolved);
  if (pending) return pending;
  cacheStats.bufferMisses += 1;
  const job = fetchUncachedAssetBuffer(resolved);
  bufferInflight.set(resolved, job);
  try {
    return await job;
  } finally {
    if (bufferInflight.get(resolved) === job) bufferInflight.delete(resolved);
  }
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

// Some AI-generated PNGs embed a C2PA/content-credentials chunk (caBX) before
// IDAT that @napi-rs/canvas cannot decode — it throws "Invalid SVG image". When
// a decode fails, strip metadata via a one-shot sharp re-encode and retry. This
// operates on the ALREADY-FETCHED bytes (no extra egress) and only on the
// decode-failure path (identical output for images that already decode); the
// decoded result is cached in imageCache, so it runs at most once per asset.
async function loadImageOrSanitize(loadImageFn, input) {
  try {
    return await loadImageFn(input);
  } catch (err) {
    try {
      const sharp = require('sharp');
      const clean = await sharp(input).png().toBuffer();
      const image = await loadImageFn(clean);
      bandwidthLog('asset image sanitized (metadata stripped)', {
        system: 'assets', cache: 'sanitize',
        name: assetFileName(typeof input === 'string' ? input : 'buffer', 'asset'),
      });
      return image;
    } catch {
      throw err; // surface the original decode error
    }
  }
}

async function loadAssetImage(loadImageFn, source) {
  const resolved = assetSource(source);
  const cached = cacheGet(imageCache, resolved, 'imageHits');
  if (cached) return cached;
  const pending = imageInflight.get(resolved);
  if (pending) return pending;
  cacheStats.imageMisses += 1;

  const job = (async () => {
    try {
      const image = isRemoteSource(resolved)
        ? await loadImageOrSanitize(loadImageFn, await fetchAssetBuffer(resolved))
        : await loadImageOrSanitize(loadImageFn, resolved);
      const result = cacheSet(imageCache, resolved, image, estimateImageBytes(image));
      // Drop duplicate remote bytes after decoding when the disk cache can reload them.
      if (isRemoteSource(resolved) && diskCacheEnabled()) cacheDelete(bufferCache, resolved);
      return result;
    } catch (err) {
      if (isRemoteSource(resolved)) {
        const rel = relativeAssetPath(resolved);
        const fallback = rel ? localAssetPath(rel) : null;
        if (fallback && fs.existsSync(fallback)) {
          const image = await loadImageOrSanitize(loadImageFn, fallback);
          cacheDelete(bufferCache, resolved);
          return cacheSet(imageCache, resolved, image, estimateImageBytes(image));
        }
      }
      throw err;
    }
  })();
  imageInflight.set(resolved, job);
  try {
    return await job;
  } finally {
    if (imageInflight.get(resolved) === job) imageInflight.delete(resolved);
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

// remoteAssetAvailable — can this asset be served straight from the R2 public
// bucket (zero bot egress)? HEAD-checked once and cached; a missing object is
// re-checked after a TTL so uploading it later needs no restart. Callers use
// this to decide URL-reference vs attach-fallback, so it must never throw.
const REMOTE_CHECK_NEGATIVE_TTL_MS = Math.max(0, Number(process.env.ASSET_REMOTE_CHECK_TTL_MS || 600_000));
const REMOTE_CHECK_MAX = envPositiveInt('ASSET_REMOTE_CHECK_MAX', 1000, { max: 10_000 });
const remoteAvailability = new Map(); // url → { promise, checkedAt, resolvedFalse }

function remoteAssetAvailable(relativePath) {
  if (!isRemoteAssetsEnabled()) return Promise.resolve(false);
  const url = getAssetUrl(relativePath);
  const entry = remoteAvailability.get(url);
  if (entry) {
    const expired = entry.resolvedFalse
      && REMOTE_CHECK_NEGATIVE_TTL_MS > 0
      && Date.now() - entry.checkedAt > REMOTE_CHECK_NEGATIVE_TTL_MS;
    if (!expired) return entry.promise;
  }
  const record = { checkedAt: Date.now(), resolvedFalse: false };
  record.promise = (async () => {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) record.resolvedFalse = true;
      return res.ok;
    } catch {
      record.resolvedFalse = true;
      return false;
    }
  })();
  remoteAvailability.set(url, record);
  while (remoteAvailability.size > REMOTE_CHECK_MAX) {
    remoteAvailability.delete(remoteAvailability.keys().next().value);
  }
  return record.promise;
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

registerMemorySource('assets.decoded-and-buffers', getAssetCacheStats);
registerMemorySource('assets.remote-availability', () => ({
  entries: remoteAvailability.size,
  maxEntries: REMOTE_CHECK_MAX,
  negativeTtlMs: REMOTE_CHECK_NEGATIVE_TTL_MS,
}));
registerMemorySource('assets.inflight', () => ({
  bufferEntries: bufferInflight.size,
  imageEntries: imageInflight.size,
}));

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
  remoteAssetAvailable,
  assetSignatureSync,
  clearAssetCache,
  sweepExpiredAssetCache,
  getAssetCacheStats,
  isRemoteSource,
  isRemoteAssetsEnabled,
};
