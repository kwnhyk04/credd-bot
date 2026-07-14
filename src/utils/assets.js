'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  envBool, envNumber, envPositiveInt, bandwidthLog,
} = require('./runtimeLogs');
const { registerMemorySource } = require('./memoryRegistry');
const {
  recordAssetCache, recordAssetDownload, recordAssetHead,
} = require('./networkTelemetry');

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
const DISK_CACHE_MAX_FILES = envPositiveInt('ASSET_DISK_CACHE_MAX_FILES', 2000, { max: 100_000 });
const DISK_CACHE_MAX_BYTES = Math.max(
  1024 * 1024,
  Math.floor(envNumber('ASSET_DISK_CACHE_MAX_MB', 96, { min: 1, max: 16_384 }) * 1024 * 1024)
);
const DISK_CACHE_SWEEP_INTERVAL_MS = Math.max(
  60 * 60_000,
  envNumber('ASSET_DISK_CACHE_SWEEP_INTERVAL_MS', 60 * 60_000, {
    min: 60 * 60_000,
    max: 7 * 24 * 60 * 60_000,
  })
);

const bufferCache = new Map();
const imageCache = new Map();
const bufferInflight = new Map();
const imageInflight = new Map();
let cacheBytes = 0;
let diskCacheSweepPromise = null;
let lastDiskCacheSweepAt = 0;
const cacheStats = {
  bufferHits: 0,
  bufferMisses: 0,
  bufferCoalesced: 0,
  imageHits: 0,
  imageMisses: 0,
  imageCoalesced: 0,
  diskHits: 0,
  diskMisses: 0,
  diskWrites: 0,
  diskWriteFailures: 0,
  diskFiles: 0,
  diskBytes: 0,
  diskSweepRuns: 0,
  diskSweepFailures: 0,
  diskEvictions: 0,
  diskEvictedBytes: 0,
  downloadedBytes: 0,
  evictions: 0,
  canonicalizedUrls: 0,
  remoteCheckHits: 0,
  remoteCheckMisses: 0,
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
  if (CACHE_TTL_MS && Date.now() - entry.lastUsed > CACHE_TTL_MS) {
    cache.delete(key);
    cacheBytes -= entry.size;
    return null;
  }
  cacheStats[hitStat] += 1;
  if (isRemoteSource(key)) {
    recordAssetCache(assetCategory(key), hitStat.startsWith('image') ? 'image' : 'buffer', 'hit');
  }
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
      if (now - entry.lastUsed <= CACHE_TTL_MS) continue;
      cache.delete(key);
      cacheBytes = Math.max(0, cacheBytes - entry.size);
      removed += 1;
    }
  }
  return removed;
}

function getAssetCacheStats() {
  sweepExpiredAssetCache();
  scheduleDiskCacheSweep();
  const bufferBytes = [...bufferCache.values()].reduce((sum, entry) => sum + entry.size, 0);
  const imageBytes = [...imageCache.values()].reduce((sum, entry) => sum + entry.size, 0);
  const bufferRequests = cacheStats.bufferHits + cacheStats.bufferMisses + cacheStats.bufferCoalesced;
  const imageRequests = cacheStats.imageHits + cacheStats.imageMisses + cacheStats.imageCoalesced;
  return {
    ...cacheStats,
    bufferEntries: bufferCache.size,
    imageEntries: imageCache.size,
    entries: cacheEntryCount(),
    bytes: cacheBytes,
    bufferBytes,
    imageBytes,
    bufferHitRate: bufferRequests
      ? Number(((cacheStats.bufferHits + cacheStats.bufferCoalesced) / bufferRequests).toFixed(4))
      : 0,
    imageHitRate: imageRequests
      ? Number(((cacheStats.imageHits + cacheStats.imageCoalesced) / imageRequests).toFixed(4))
      : 0,
    maxEntries: CACHE_MAX_ENTRIES,
    maxBytes: CACHE_MAX_BYTES,
    ttlMs: CACHE_TTL_MS,
    diskEnabled: diskCacheEnabled(),
    diskRoot: DISK_CACHE_ROOT,
    diskMaxFiles: DISK_CACHE_MAX_FILES,
    diskMaxBytes: DISK_CACHE_MAX_BYTES,
    diskSweepIntervalMs: DISK_CACHE_SWEEP_INTERVAL_MS,
    diskSweepInFlight: Boolean(diskCacheSweepPromise),
    diskLastSweepAt: lastDiskCacheSweepAt || null,
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
  return envBool('ASSET_DISK_CACHE_ENABLED', true);
}

function managedRemoteRelativePath(source) {
  const base = assetBaseUrl();
  if (!base || !isRemoteSource(source)) return null;
  try {
    const baseUrl = new URL(`${base}/`);
    const sourceUrl = new URL(String(source));
    if (sourceUrl.origin.toLowerCase() !== baseUrl.origin.toLowerCase()) return null;
    const basePath = baseUrl.pathname.replace(/\/+$/, '');
    if (basePath && sourceUrl.pathname !== basePath && !sourceUrl.pathname.startsWith(`${basePath}/`)) return null;
    const relative = sourceUrl.pathname.slice(basePath.length).replace(/^\/+/, '');
    return relative ? cleanAssetPath(relative) : null;
  } catch {
    return null;
  }
}

function assetCategory(source) {
  const relative = managedRemoteRelativePath(source);
  if (relative) return relative.split('/').filter(Boolean)[0] || 'root';
  if (isRemoteSource(source)) return 'external';
  return cleanAssetPath(relativeAssetPath(source)).split('/').filter(Boolean)[0] || 'local';
}

function diskCacheAllowed(source) {
  return diskCacheEnabled() && managedRemoteRelativePath(source) !== null;
}

function diskCacheIdentity(source) {
  const raw = String(source || '');
  try {
    const url = new URL(raw);
    const version = assetVersion();
    return version ? `${url.protocol}//${url.host}${url.pathname}\n${version}` : raw;
  } catch {
    return assetVersion() ? raw.replace(/[?#].*$/, '') : raw;
  }
}

function diskCachePath(source) {
  const id = diskCacheIdentity(source);
  const hash = crypto.createHash('sha256').update(id).digest('hex');
  const ext = assetExtension(String(source || '').replace(/[?#].*$/, ''), 'bin');
  return path.join(DISK_CACHE_ROOT, `${hash}.${ext}`);
}

async function sweepDiskCache() {
  cacheStats.diskSweepRuns += 1;
  let entries;
  try {
    entries = await fs.promises.readdir(DISK_CACHE_ROOT, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      cacheStats.diskFiles = 0;
      cacheStats.diskBytes = 0;
      return;
    }
    throw err;
  }

  const files = [];
  let totalBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(DISK_CACHE_ROOT, entry.name);
    try {
      const stat = await fs.promises.stat(file);
      files.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
      totalBytes += stat.size;
    } catch (err) {
      if (err?.code !== 'ENOENT') cacheStats.diskSweepFailures += 1;
    }
  }

  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let fileCount = files.length;
  for (const entry of files) {
    if (fileCount <= DISK_CACHE_MAX_FILES && totalBytes <= DISK_CACHE_MAX_BYTES) break;
    try {
      await fs.promises.unlink(entry.file);
      fileCount -= 1;
      totalBytes = Math.max(0, totalBytes - entry.size);
      cacheStats.diskEvictions += 1;
      cacheStats.diskEvictedBytes += entry.size;
    } catch (err) {
      if (err?.code === 'ENOENT') {
        fileCount -= 1;
        totalBytes = Math.max(0, totalBytes - entry.size);
      } else {
        cacheStats.diskSweepFailures += 1;
      }
    }
  }
  cacheStats.diskFiles = fileCount;
  cacheStats.diskBytes = totalBytes;
}

function scheduleDiskCacheSweep() {
  if (!diskCacheEnabled()) return null;
  const now = Date.now();
  if (diskCacheSweepPromise || now - lastDiskCacheSweepAt < DISK_CACHE_SWEEP_INTERVAL_MS) {
    return diskCacheSweepPromise;
  }
  lastDiskCacheSweepAt = now;
  const job = sweepDiskCache()
    .catch(() => {
      cacheStats.diskSweepFailures += 1;
    })
    .finally(() => {
      if (diskCacheSweepPromise === job) diskCacheSweepPromise = null;
    });
  diskCacheSweepPromise = job;
  return job;
}

async function readDiskCache(source) {
  if (!diskCacheAllowed(source)) return null;
  const file = diskCachePath(source);
  try {
    const buffer = await fs.promises.readFile(file);
    cacheStats.diskHits += 1;
    scheduleDiskCacheSweep();
    return buffer;
  } catch {
    cacheStats.diskMisses += 1;
    scheduleDiskCacheSweep();
    return null;
  }
}

async function writeDiskCache(source, buffer) {
  if (!diskCacheAllowed(source) || !Buffer.isBuffer(buffer)) return;
  if (buffer.length > DISK_CACHE_MAX_BYTES) return;
  const file = diskCachePath(source);
  try {
    await fs.promises.mkdir(DISK_CACHE_ROOT, { recursive: true });
    await fs.promises.writeFile(file, buffer);
    cacheStats.diskWrites += 1;
    scheduleDiskCacheSweep();
  } catch {
    cacheStats.diskWriteFailures += 1;
    // Disk cache is opportunistic; memory cache and fetch fallback remain authoritative.
  }
}

function assetSource(source) {
  if (!source) return source;
  if (isRemoteSource(source)) {
    if (!assetVersion()) return source;
    const relative = managedRemoteRelativePath(source);
    if (!relative) return source;
    const canonical = getAssetUrl(relative);
    if (canonical !== String(source)) cacheStats.canonicalizedUrls += 1;
    return canonical;
  }

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
    let networkRecorded = false;
    try {
      const res = await fetch(resolved);
      if (!res.ok) {
        recordAssetDownload(assetCategory(resolved), 0, false);
        networkRecorded = true;
        throw new Error(`Asset fetch failed ${res.status}: ${resolved}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      recordAssetDownload(assetCategory(resolved), buffer.length, true);
      networkRecorded = true;
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
      if (!networkRecorded) recordAssetDownload(assetCategory(resolved), 0, false);
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
  if (pending) {
    cacheStats.bufferCoalesced += 1;
    if (isRemoteSource(resolved)) recordAssetCache(assetCategory(resolved), 'buffer', 'coalesced');
    return pending;
  }
  cacheStats.bufferMisses += 1;
  if (isRemoteSource(resolved)) recordAssetCache(assetCategory(resolved), 'buffer', 'miss');
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
async function loadImageOrSanitize(loadImageFn, input, { sanitizedPath = null } = {}) {
  try {
    return await loadImageFn(input);
  } catch (err) {
    try {
      const sharp = require('sharp');
      const clean = await sharp(input).png().toBuffer();
      let image;
      if (sanitizedPath) {
        try {
          await fs.promises.writeFile(sanitizedPath, clean);
          cacheStats.diskWrites += 1;
          scheduleDiskCacheSweep();
          image = await loadImageFn(sanitizedPath);
        } catch {
          image = await loadImageFn(clean);
        }
      } else {
        image = await loadImageFn(clean);
      }
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

async function loadRemoteAssetImage(loadImageFn, resolved) {
  if (diskCacheAllowed(resolved)) {
    const file = diskCachePath(resolved);
    const sanitizedPath = `${file}.decoded.png`;
    try {
      await fs.promises.access(sanitizedPath, fs.constants.R_OK);
      const image = await loadImageFn(sanitizedPath);
      cacheStats.diskHits += 1;
      scheduleDiskCacheSweep();
      return image;
    } catch {
      // Try the original cached object before downloading it again.
      await fs.promises.unlink(sanitizedPath).catch(() => {});
    }
    try {
      await fs.promises.access(file, fs.constants.R_OK);
      const image = await loadImageOrSanitize(loadImageFn, file, { sanitizedPath });
      cacheStats.diskHits += 1;
      scheduleDiskCacheSweep();
      return image;
    } catch {
      // Missing or corrupt disk entries fall through to the authoritative URL.
      await fs.promises.unlink(file).catch(() => {});
      await fs.promises.unlink(sanitizedPath).catch(() => {});
    }

    const buffer = await fetchAssetBuffer(resolved);
    try {
      await fs.promises.access(sanitizedPath, fs.constants.R_OK);
      return await loadImageFn(sanitizedPath);
    } catch {
      try {
        await fs.promises.access(file, fs.constants.R_OK);
        return await loadImageOrSanitize(loadImageFn, file, { sanitizedPath });
      } catch {
        return loadImageOrSanitize(loadImageFn, buffer);
      }
    }
  }

  return loadImageOrSanitize(loadImageFn, await fetchAssetBuffer(resolved));
}

async function loadAssetImage(loadImageFn, source) {
  const resolved = assetSource(source);
  const cached = cacheGet(imageCache, resolved, 'imageHits');
  if (cached) return cached;
  const pending = imageInflight.get(resolved);
  if (pending) {
    cacheStats.imageCoalesced += 1;
    if (isRemoteSource(resolved)) recordAssetCache(assetCategory(resolved), 'image', 'coalesced');
    return pending;
  }
  cacheStats.imageMisses += 1;
  if (isRemoteSource(resolved)) recordAssetCache(assetCategory(resolved), 'image', 'miss');

  const job = (async () => {
    try {
      const image = isRemoteSource(resolved)
        ? await loadRemoteAssetImage(loadImageFn, resolved)
        : await loadImageOrSanitize(loadImageFn, resolved);
      const result = cacheSet(imageCache, resolved, image, estimateImageBytes(image));
      // Decoded images and their compressed source bytes should not occupy memory together.
      if (isRemoteSource(resolved)) cacheDelete(bufferCache, resolved);
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
    if (!expired) {
      cacheStats.remoteCheckHits += 1;
      return entry.promise;
    }
  }
  cacheStats.remoteCheckMisses += 1;
  const record = { checkedAt: Date.now(), resolvedFalse: false };
  record.promise = (async () => {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      recordAssetHead(assetCategory(url), res.ok);
      if (!res.ok) record.resolvedFalse = true;
      return res.ok;
    } catch {
      recordAssetHead(assetCategory(url), false);
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
