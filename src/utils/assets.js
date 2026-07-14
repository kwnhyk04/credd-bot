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
const DISK_CACHE_ROOT_CONFIGURED = Boolean(
  String(process.env.ASSET_DISK_CACHE_DIR || process.env.ASSET_DISK_CACHE_ROOT || '').trim()
);
const DISK_CACHE_ROOT = path.resolve(
  String(process.env.ASSET_DISK_CACHE_DIR || process.env.ASSET_DISK_CACHE_ROOT || '').trim()
    || path.join(process.cwd(), '.cache', 'assets')
);
const DISK_CACHE_SENTINEL = '.credd-asset-cache-v1';
const HASHED_CACHE_FILE_RE = /^[a-f0-9]{64}\.[a-z0-9]+(?:\.decoded\.png)?$/;
const ICON_CACHE_FILE_RE = /^emoji-[a-z0-9_-]{1,100}\.png$/i;
const CACHE_TEMP_FILE_RE = /^\.(?:[a-f0-9]{64}\.[a-z0-9]+(?:\.decoded\.png)?|emoji-[a-z0-9_-]{1,100}\.png)\.\d+\.[a-f0-9]+\.tmp$/i;
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
  Math.floor(envNumber('ASSET_DISK_CACHE_MAX_MB', 384, { min: 1, max: 16_384 }) * 1024 * 1024)
);
const DISK_CACHE_SWEEP_INTERVAL_MS = Math.max(
  60 * 60_000,
  envNumber('ASSET_DISK_CACHE_SWEEP_INTERVAL_MS', 60 * 60_000, {
    min: 60 * 60_000,
    max: 7 * 24 * 60 * 60_000,
  })
);
const DISK_CACHE_TOUCH_INTERVAL_MS = Math.max(
  60_000,
  envNumber('ASSET_DISK_CACHE_TOUCH_INTERVAL_MS', 300_000, { min: 60_000, max: 86_400_000 })
);
const DISK_CACHE_SWEEP_WRITE_THRESHOLD = envPositiveInt(
  'ASSET_DISK_CACHE_SWEEP_WRITE_THRESHOLD', 16, { max: 1000 }
);
const REMOTE_FETCH_MISS_TTL_MS = Math.max(
  0,
  envNumber('ASSET_REMOTE_MISS_TTL_MS', 600_000, { min: 0, max: 86_400_000 })
);
const REMOTE_FETCH_MISS_MAX = envPositiveInt('ASSET_REMOTE_MISS_MAX', 1000, { max: 10_000 });

const bufferCache = new Map();
const imageCache = new Map();
const bufferInflight = new Map();
const imageInflight = new Map();
const remoteFetchMisses = new Map();
let cacheBytes = 0;
let diskCacheSweepPromise = null;
let diskCacheOwnershipPromise = null;
let diskCacheMutationTail = Promise.resolve();
let diskCacheSweepForcePending = false;
let lastDiskCacheSweepAt = 0;
let diskCacheReady = false;
let diskCacheLastError = null;
let diskCacheWritesSinceSweep = 0;
let diskCacheWriteGeneration = 0;
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
  diskIgnoredFiles: 0,
  diskEvictions: 0,
  diskEvictedBytes: 0,
  diskTouches: 0,
  downloadedBytes: 0,
  evictions: 0,
  canonicalizedUrls: 0,
  remoteCheckHits: 0,
  remoteCheckMisses: 0,
  remoteFetchNegativeHits: 0,
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
  const now = Date.now();
  if (isRemoteSource(key)) {
    recordAssetCache(assetCategory(key), hitStat.startsWith('image') ? 'image' : 'buffer', 'hit');
    if (diskCacheAllowed(key) && now - (entry.diskTouchedAt || 0) >= DISK_CACHE_TOUCH_INTERVAL_MS) {
      entry.diskTouchedAt = now;
      const file = diskCachePath(key);
      void touchDiskCacheFile(file);
      if (hitStat.startsWith('image')) void touchDiskCacheFile(`${file}.decoded.png`);
    }
  }
  entry.lastUsed = now;
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
  cache.set(key, { value, size, createdAt: now, lastUsed: now, diskTouchedAt: 0 });
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
    diskRootConfigured: DISK_CACHE_ROOT_CONFIGURED,
    diskReady: diskCacheReady,
    diskLastError: diskCacheLastError,
    diskMaxFiles: DISK_CACHE_MAX_FILES,
    diskMaxBytes: DISK_CACHE_MAX_BYTES,
    diskSweepIntervalMs: DISK_CACHE_SWEEP_INTERVAL_MS,
    diskTouchIntervalMs: DISK_CACHE_TOUCH_INTERVAL_MS,
    diskWritesSinceSweep: diskCacheWritesSinceSweep,
    diskSweepInFlight: Boolean(diskCacheSweepPromise),
    diskSweepForcePending: diskCacheSweepForcePending,
    diskLastSweepAt: lastDiskCacheSweepAt || null,
    negativeEntries: remoteFetchMisses.size,
    negativeMaxEntries: REMOTE_FETCH_MISS_MAX,
    negativeTtlMs: REMOTE_FETCH_MISS_TTL_MS,
  };
}

function assertSafeAssetSegment(segment) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return;
  }
  if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
    throw new Error(`Unsafe asset path segment: ${segment}`);
  }
}

function cleanAssetPath(relativePath) {
  const clean = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .replace(/^\/+/, '');
  for (const segment of clean.split('/')) {
    if (segment) assertSafeAssetSegment(segment);
  }
  return clean;
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveLocalAssetPath(relativePath) {
  const cleanPath = cleanAssetPath(relativePath);
  const candidate = path.resolve(ASSETS_ROOT, ...cleanPath.split('/').filter(Boolean));
  if (!pathIsWithin(ASSETS_ROOT, candidate)) throw new Error(`Asset path escapes assets root: ${relativePath}`);
  return candidate;
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
  if (baseUrl) return versionedAssetUrl(`${baseUrl}/${canonicalUrlPathname(cleanPath)}`);
  return resolveLocalAssetPath(cleanPath);
}

function getAssetUrl(relativePath) {
  const baseUrl = assetBaseUrl();
  if (!baseUrl) throw new Error('ASSET_BASE_URL is missing');
  return versionedAssetUrl(`${baseUrl}/${canonicalUrlPathname(cleanAssetPath(relativePath))}`);
}

function localAssetPath(relativePath) {
  return resolveLocalAssetPath(relativePath);
}

function isRemoteSource(source) {
  return /^https?:\/\//i.test(String(source || ''));
}

function assertSafeRemoteAssetUrl(source) {
  const rawPath = String(source || '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/[?#].*$/, '');
  for (const segment of rawPath.replace(/\\/g, '/').split('/')) {
    if (segment) assertSafeAssetSegment(segment);
  }
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

function assetDiskCacheRoot() {
  return DISK_CACHE_ROOT;
}

function recognizedDiskCacheFileName(name) {
  return HASHED_CACHE_FILE_RE.test(String(name || '')) || ICON_CACHE_FILE_RE.test(String(name || ''));
}

function diskCacheRootConfigurationError(root = DISK_CACHE_ROOT) {
  const resolved = path.resolve(root);
  const filesystemRoot = path.parse(resolved).root;
  const cwd = path.resolve(process.cwd());
  const gitRoot = path.join(cwd, '.git');
  if (resolved === filesystemRoot) return 'cache directory cannot be a filesystem root';
  if (pathIsWithin(resolved, cwd)) return 'cache directory cannot be the project directory or one of its ancestors';
  if (pathIsWithin(ASSETS_ROOT, resolved)) return 'cache directory cannot be inside the source assets directory';
  if (pathIsWithin(gitRoot, resolved)) return 'cache directory cannot be inside .git';
  return null;
}

async function ensureDiskCacheRootOwned() {
  if (diskCacheOwnershipPromise) return diskCacheOwnershipPromise;
  const job = (async () => {
    const unsafe = diskCacheRootConfigurationError();
    if (unsafe) throw new Error(`Unsafe ASSET_DISK_CACHE_DIR (${DISK_CACHE_ROOT}): ${unsafe}`);
    await fs.promises.mkdir(DISK_CACHE_ROOT, { recursive: true });
    const entries = await fs.promises.readdir(DISK_CACHE_ROOT, { withFileTypes: true });
    const sentinel = entries.find((entry) => entry.name === DISK_CACHE_SENTINEL);
    if (sentinel && !sentinel.isFile()) throw new Error(`Asset cache sentinel is not a file: ${DISK_CACHE_SENTINEL}`);
    if (!sentinel) {
      const unexpected = entries.filter((entry) => {
        if (!entry.isFile()) return true;
        return !recognizedDiskCacheFileName(entry.name)
          && !CACHE_TEMP_FILE_RE.test(entry.name)
          && !/^\.write-probe-\d+-\d+$/.test(entry.name);
      });
      if (unexpected.length > 0) {
        throw new Error(`Asset cache directory is not dedicated (unexpected entry: ${unexpected[0].name})`);
      }
      await fs.promises.writeFile(
        path.join(DISK_CACHE_ROOT, DISK_CACHE_SENTINEL),
        'Credd asset cache v1\n',
        { flag: 'wx' }
      ).catch((err) => {
        if (err?.code !== 'EEXIST') throw err;
      });
    }
    return true;
  })();
  diskCacheOwnershipPromise = job;
  try {
    return await job;
  } catch (err) {
    if (diskCacheOwnershipPromise === job) diskCacheOwnershipPromise = null;
    throw err;
  }
}

function namedDiskCachePath(name) {
  const fileName = String(name || '');
  if (!recognizedDiskCacheFileName(fileName)) throw new Error(`Unrecognized asset cache filename: ${fileName}`);
  return path.join(DISK_CACHE_ROOT, fileName);
}

function withDiskCacheMutation(fn) {
  const job = diskCacheMutationTail.then(fn, fn);
  diskCacheMutationTail = job.catch(() => {});
  return job;
}

const EXTERNAL_DISK_CACHE_HOSTS = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
]);

function canonicalUrlPathname(pathname) {
  return String(pathname || '').split('/').map((segment) => {
    if (!segment) return segment;
    assertSafeAssetSegment(segment);
    try {
      const decoded = decodeURIComponent(segment);
      return encodeURIComponent(decoded);
    } catch {
      return segment.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
    }
  }).join('/');
}

function canonicalExternalUrl(source) {
  try {
    const url = new URL(String(source));
    url.hash = '';
    url.pathname = canonicalUrlPathname(url.pathname);
    url.searchParams.sort();
    return url.toString();
  } catch {
    return String(source || '');
  }
}

function externalDiskCacheAllowed(source) {
  if (!isRemoteSource(source)) return false;
  try {
    return EXTERNAL_DISK_CACHE_HOSTS.has(new URL(String(source)).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function managedRemoteRelativePath(source) {
  const base = assetBaseUrl();
  if (!base || !isRemoteSource(source)) return null;
  try {
    const baseUrl = new URL(`${base}/`);
    const sourceUrl = new URL(String(source));
    if (sourceUrl.origin.toLowerCase() !== baseUrl.origin.toLowerCase()) return null;
    const basePath = canonicalUrlPathname(baseUrl.pathname).replace(/\/+$/, '');
    const sourcePath = canonicalUrlPathname(sourceUrl.pathname);
    if (basePath && sourcePath !== basePath && !sourcePath.startsWith(`${basePath}/`)) return null;
    const relative = sourcePath.slice(basePath.length).replace(/^\/+/, '');
    return relative ? cleanAssetPath(relative) : null;
  } catch {
    return null;
  }
}

function assetCategory(source) {
  const relative = managedRemoteRelativePath(source);
  if (relative) {
    const parts = relative.toLowerCase().split('/').filter(Boolean);
    const nested = parts.slice(1).join('/');
    if (parts[0] === 'classes' && parts[1] === 'battle_base') return 'battle_backgrounds';
    if (parts[0] === 'classes') return 'class_assets';
    if (parts[0] === 'skins' && parts[1] === 'avatars') return 'avatars';
    if (parts[0] === 'skins' && /(battle|victory|defeated|\/result\/)/.test(nested)) return 'battle_skins';
    if (parts[0] === 'skins' && /(profile|stats)/.test(nested)) return 'profile_skins';
    if (parts[0] === 'skins' && /(summon|card_flip)/.test(nested)) return 'summon_skins';
    if (parts[0] === 'weapons' || parts[0] === 'items') return 'equipment_assets';
    if (parts[0] === 'deities') return 'deity_assets';
    if (parts[0] === 'monsters' && parts[1] === 'boss') return 'boss_assets';
    if (parts[0] === 'cache' && parts[1] === 'canvas') return 'generated_renders';
    return parts[0] || 'root';
  }
  if (externalDiskCacheAllowed(source)) return 'discord_cdn';
  if (isRemoteSource(source)) return 'external';
  return cleanAssetPath(relativeAssetPath(source)).split('/').filter(Boolean)[0] || 'local';
}

function diskCacheAllowed(source) {
  return diskCacheEnabled()
    && (managedRemoteRelativePath(source) !== null || externalDiskCacheAllowed(source));
}

function diskCacheIdentity(source) {
  const raw = String(source || '');
  try {
    const url = new URL(raw);
    const version = assetVersion();
    const managed = managedRemoteRelativePath(raw);
    if (managed !== null) {
      return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}/${managed}\n${version}`;
    }
    return externalDiskCacheAllowed(raw) ? canonicalExternalUrl(raw) : raw;
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

async function sweepDiskCacheUnlocked() {
  cacheStats.diskSweepRuns += 1;
  await ensureDiskCacheRootOwned();
  const generationAtStart = diskCacheWriteGeneration;
  let entries;
  try {
    entries = await fs.promises.readdir(DISK_CACHE_ROOT, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      cacheStats.diskFiles = 0;
      cacheStats.diskBytes = 0;
      diskCacheWritesSinceSweep = 0;
      return;
    }
    throw err;
  }

  const files = [];
  let totalBytes = 0;
  let ignoredFiles = 0;
  const now = Date.now();
  for (const entry of entries) {
    if (entry.name === DISK_CACHE_SENTINEL) continue;
    if (!entry.isFile()) {
      ignoredFiles += 1;
      continue;
    }
    const file = path.join(DISK_CACHE_ROOT, entry.name);
    try {
      const stat = await fs.promises.stat(file);
      if (CACHE_TEMP_FILE_RE.test(entry.name)) {
        if (now - stat.mtimeMs > 10 * 60_000) await fs.promises.unlink(file).catch(() => {});
        continue;
      }
      if (!recognizedDiskCacheFileName(entry.name)) {
        ignoredFiles += 1;
        continue;
      }
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
  cacheStats.diskIgnoredFiles = ignoredFiles;
  if (generationAtStart === diskCacheWriteGeneration) {
    diskCacheWritesSinceSweep = 0;
  } else {
    diskCacheSweepForcePending = true;
  }
}

function sweepDiskCache() {
  return withDiskCacheMutation(sweepDiskCacheUnlocked);
}

function scheduleDiskCacheSweep(force = false) {
  if (!diskCacheEnabled()) return null;
  const now = Date.now();
  if (diskCacheSweepPromise) {
    if (force) diskCacheSweepForcePending = true;
    return diskCacheSweepPromise;
  }
  if (!force && now - lastDiskCacheSweepAt < DISK_CACHE_SWEEP_INTERVAL_MS) return null;
  lastDiskCacheSweepAt = now;
  const job = sweepDiskCache()
    .catch((err) => {
      cacheStats.diskSweepFailures += 1;
      diskCacheLastError = err?.message || String(err);
    })
    .finally(() => {
      if (diskCacheSweepPromise === job) diskCacheSweepPromise = null;
      if (diskCacheSweepForcePending) {
        diskCacheSweepForcePending = false;
        scheduleDiskCacheSweep(true);
      }
    });
  diskCacheSweepPromise = job;
  return job;
}

async function touchDiskCacheFile(file) {
  try {
    await ensureDiskCacheRootOwned();
    const stat = await fs.promises.stat(file);
    const now = Date.now();
    if (now - stat.mtimeMs < DISK_CACHE_TOUCH_INTERVAL_MS) return;
    const date = new Date(now);
    await fs.promises.utimes(file, date, date);
    cacheStats.diskTouches += 1;
  } catch {
    // A concurrent sweep may remove the file after it was read; the caller still has its bytes.
  }
}

async function atomicWriteDiskCacheFile(file, buffer) {
  await ensureDiskCacheRootOwned();
  const name = path.basename(file);
  if (!recognizedDiskCacheFileName(name)) throw new Error(`Unrecognized asset cache filename: ${name}`);
  const temp = path.join(
    DISK_CACHE_ROOT,
    `.${name}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  try {
    await fs.promises.writeFile(temp, buffer, { flag: 'wx' });
    try {
      await fs.promises.rename(temp, file);
    } catch (err) {
      if (!['EEXIST', 'EPERM'].includes(err?.code)) throw err;
      await fs.promises.unlink(file).catch((unlinkErr) => {
        if (unlinkErr?.code !== 'ENOENT') throw unlinkErr;
      });
      await fs.promises.rename(temp, file);
    }
  } finally {
    await fs.promises.unlink(temp).catch(() => {});
  }
}

async function writeTrackedDiskCacheFile(file, buffer) {
  return withDiskCacheMutation(async () => {
    const previous = await fs.promises.stat(file).catch(() => null);
    await atomicWriteDiskCacheFile(file, buffer);
    cacheStats.diskWrites += 1;
    cacheStats.diskFiles += previous ? 0 : 1;
    cacheStats.diskBytes = Math.max(0, cacheStats.diskBytes - (previous?.size || 0) + buffer.length);
    diskCacheWritesSinceSweep += 1;
    diskCacheWriteGeneration += 1;
    const overLimit = cacheStats.diskFiles > DISK_CACHE_MAX_FILES
      || cacheStats.diskBytes > DISK_CACHE_MAX_BYTES
      || diskCacheWritesSinceSweep >= DISK_CACHE_SWEEP_WRITE_THRESHOLD;
    scheduleDiskCacheSweep(overLimit);
    return file;
  });
}

async function readDiskCache(source) {
  if (!diskCacheAllowed(source)) return null;
  const file = diskCachePath(source);
  try {
    await ensureDiskCacheRootOwned();
    const buffer = await fs.promises.readFile(file);
    cacheStats.diskHits += 1;
    diskCacheReady = true;
    diskCacheLastError = null;
    recordAssetCache(assetCategory(source), 'disk', 'hit');
    await touchDiskCacheFile(file);
    scheduleDiskCacheSweep();
    return buffer;
  } catch (err) {
    cacheStats.diskMisses += 1;
    if (err?.code !== 'ENOENT') diskCacheLastError = err?.message || String(err);
    recordAssetCache(assetCategory(source), 'disk', 'miss');
    scheduleDiskCacheSweep();
    return null;
  }
}

async function writeDiskCache(source, buffer) {
  if (!diskCacheAllowed(source) || !Buffer.isBuffer(buffer)) return;
  if (buffer.length > DISK_CACHE_MAX_BYTES) return;
  const file = diskCachePath(source);
  try {
    await writeTrackedDiskCacheFile(file, buffer);
    diskCacheReady = true;
    diskCacheLastError = null;
  } catch (err) {
    cacheStats.diskWriteFailures += 1;
    diskCacheLastError = err?.message || String(err);
    // Disk cache is opportunistic; memory cache and fetch fallback remain authoritative.
  }
}

function assetDiskCacheEnabled() {
  return diskCacheEnabled();
}

async function readAssetDiskCacheFile(name) {
  if (!diskCacheEnabled()) return null;
  const file = namedDiskCachePath(name);
  try {
    await ensureDiskCacheRootOwned();
    await fs.promises.access(file, fs.constants.R_OK);
    cacheStats.diskHits += 1;
    diskCacheReady = true;
    diskCacheLastError = null;
    await touchDiskCacheFile(file);
    scheduleDiskCacheSweep();
    return file;
  } catch (err) {
    cacheStats.diskMisses += 1;
    if (err?.code !== 'ENOENT') diskCacheLastError = err?.message || String(err);
    scheduleDiskCacheSweep();
    return null;
  }
}

async function writeAssetDiskCacheFile(name, buffer) {
  if (!diskCacheEnabled() || !Buffer.isBuffer(buffer) || buffer.length > DISK_CACHE_MAX_BYTES) return null;
  const file = namedDiskCachePath(name);
  try {
    await writeTrackedDiskCacheFile(file, buffer);
    diskCacheReady = true;
    diskCacheLastError = null;
    return file;
  } catch (err) {
    cacheStats.diskWriteFailures += 1;
    diskCacheLastError = err?.message || String(err);
    return null;
  }
}

async function removeAssetDiskCacheFile(name) {
  if (!diskCacheEnabled()) return false;
  const file = namedDiskCachePath(name);
  return withDiskCacheMutation(async () => {
    try {
      await ensureDiskCacheRootOwned();
      const stat = await fs.promises.stat(file).catch(() => null);
      await fs.promises.unlink(file);
      cacheStats.diskFiles = Math.max(0, cacheStats.diskFiles - 1);
      cacheStats.diskBytes = Math.max(0, cacheStats.diskBytes - (stat?.size || 0));
      diskCacheWritesSinceSweep += 1;
      diskCacheWriteGeneration += 1;
      scheduleDiskCacheSweep(true);
      return true;
    } catch (err) {
      if (err?.code !== 'ENOENT') diskCacheLastError = err?.message || String(err);
      return false;
    }
  });
}

async function touchAssetDiskCacheFile(name) {
  if (!diskCacheEnabled()) return;
  return touchDiskCacheFile(namedDiskCachePath(name));
}

async function verifyAssetDiskCacheReady() {
  if (!diskCacheEnabled()) return { enabled: false, ready: false, root: DISK_CACHE_ROOT };
  const probe = path.join(DISK_CACHE_ROOT, `.write-probe-${process.pid}-${Date.now()}`);
  try {
    await ensureDiskCacheRootOwned();
    await fs.promises.writeFile(probe, 'ok', { flag: 'wx' });
    await fs.promises.unlink(probe);
    await scheduleDiskCacheSweep(true);
    diskCacheReady = true;
    diskCacheLastError = null;
    return {
      enabled: true,
      ready: true,
      root: DISK_CACHE_ROOT,
      configuredRoot: DISK_CACHE_ROOT_CONFIGURED,
      files: cacheStats.diskFiles,
      bytes: cacheStats.diskBytes,
      maxFiles: DISK_CACHE_MAX_FILES,
      maxBytes: DISK_CACHE_MAX_BYTES,
    };
  } catch (err) {
    diskCacheReady = false;
    diskCacheLastError = err?.message || String(err);
    await fs.promises.unlink(probe).catch(() => {});
    throw err;
  }
}

function assetSource(source) {
  if (!source) return source;
  if (isRemoteSource(source)) {
    assertSafeRemoteAssetUrl(source);
    const relative = managedRemoteRelativePath(source);
    let canonical = String(source);
    if (relative) {
      canonical = getAssetUrl(relative);
    } else if (externalDiskCacheAllowed(source)) {
      canonical = canonicalExternalUrl(source);
    }
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

function cachedRemoteFetchMiss(resolved) {
  if (!REMOTE_FETCH_MISS_TTL_MS || managedRemoteRelativePath(resolved) === null) return null;
  const entry = remoteFetchMisses.get(resolved);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    remoteFetchMisses.delete(resolved);
    return null;
  }
  remoteFetchMisses.delete(resolved);
  remoteFetchMisses.set(resolved, entry);
  return entry;
}

function rememberRemoteFetchMiss(resolved, status) {
  if (!REMOTE_FETCH_MISS_TTL_MS || ![404, 410].includes(Number(status))) return;
  if (managedRemoteRelativePath(resolved) === null) return;
  remoteFetchMisses.delete(resolved);
  remoteFetchMisses.set(resolved, {
    status: Number(status),
    expiresAt: Date.now() + REMOTE_FETCH_MISS_TTL_MS,
  });
  while (remoteFetchMisses.size > REMOTE_FETCH_MISS_MAX) {
    remoteFetchMisses.delete(remoteFetchMisses.keys().next().value);
  }
}

function clearRemoteFetchMiss(source) {
  remoteFetchMisses.delete(assetSource(source));
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
        const error = new Error(`Asset fetch failed ${res.status}: ${resolved}`);
        error.status = res.status;
        throw error;
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
  const negative = cachedRemoteFetchMiss(resolved);
  if (negative) {
    cacheStats.remoteFetchNegativeHits += 1;
    recordAssetCache(assetCategory(resolved), 'negative', 'hit');
    const error = new Error(`Asset fetch cached ${negative.status}: ${resolved}`);
    error.status = negative.status;
    throw error;
  }
  const pending = bufferInflight.get(resolved);
  if (pending) {
    cacheStats.bufferCoalesced += 1;
    if (isRemoteSource(resolved)) recordAssetCache(assetCategory(resolved), 'buffer', 'coalesced');
    return pending;
  }
  cacheStats.bufferMisses += 1;
  if (isRemoteSource(resolved)) recordAssetCache(assetCategory(resolved), 'buffer', 'miss');
  const job = fetchUncachedAssetBuffer(resolved).then((buffer) => {
    remoteFetchMisses.delete(resolved);
    return buffer;
  }).catch((err) => {
    rememberRemoteFetchMiss(resolved, err?.status);
    throw err;
  });
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
          await writeTrackedDiskCacheFile(sanitizedPath, clean);
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
      recordAssetCache(assetCategory(resolved), 'disk', 'hit');
      await touchDiskCacheFile(sanitizedPath);
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
      recordAssetCache(assetCategory(resolved), 'disk', 'hit');
      await touchDiskCacheFile(file);
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
      return entry.promise.then((available) => {
        if (available) clearRemoteFetchMiss(url);
        return available;
      });
    }
  }
  cacheStats.remoteCheckMisses += 1;
  const record = { checkedAt: Date.now(), resolvedFalse: false };
  record.promise = (async () => {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      recordAssetHead(assetCategory(url), res.ok);
      if (res.ok) clearRemoteFetchMiss(url);
      else record.resolvedFalse = true;
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
registerMemorySource('assets.remote-fetch-misses', () => ({
  entries: remoteFetchMisses.size,
  maxEntries: REMOTE_FETCH_MISS_MAX,
  ttlMs: REMOTE_FETCH_MISS_TTL_MS,
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
  assetDiskCacheRoot,
  assetDiskCacheEnabled,
  diskCacheRootConfigurationError,
  readAssetDiskCacheFile,
  writeAssetDiskCacheFile,
  removeAssetDiskCacheFile,
  touchAssetDiskCacheFile,
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
  verifyAssetDiskCacheReady,
  isRemoteSource,
  isRemoteAssetsEnabled,
};
