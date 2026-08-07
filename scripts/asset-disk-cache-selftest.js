'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createCanvas } = require('@napi-rs/canvas');

const cacheRoot = path.join(os.tmpdir(), `credd-asset-cache-${process.pid}-${Date.now()}`);
const unsafeRoot = `${cacheRoot}-unsafe`;
assert.ok(cacheRoot.startsWith(os.tmpdir()), 'test cache must stay inside the OS temp directory');
process.env.ASSET_BASE_URL = 'https://cdn.example.test/bucket';
process.env.ASSET_VERSION = 'asset-cache-selftest';
process.env.ASSET_DISK_CACHE_ENABLED = 'true';
process.env.ASSET_DISK_CACHE_DIR = cacheRoot;
process.env.ASSET_DISK_CACHE_MAX_MB = '4';
process.env.ASSET_MEMORY_CACHE_MAX_MB = '40';
process.env.ASSET_REMOTE_MISS_TTL_MS = '600000';
process.env.EMOJI_IMAGE_CACHE_TTL_MS = '1';
process.env.BANDWIDTH_LOGS = 'false';

function pngBuffer(color) {
  const canvas = createCanvas(16, 16);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 16, 16);
  return canvas.toBuffer('image/png');
}

const managedBuffers = new Map([
  ['/bucket/classes/battle_base/Test Image.png', Buffer.from('static-battle-background')],
  ['/bucket/skins/avatars/male/archer/Hero Image.png', pngBuffer('#a020f0')],
]);
const discordAvatar = pngBuffer('#2080f0');
const fetchCalls = [];
let failEmojiDownloads = false;

global.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  fetchCalls.push(`${String(options.method || 'GET').toUpperCase()} ${url}`);
  await new Promise((resolve) => setTimeout(resolve, 10));
  if (url.hostname === 'cdn.discordapp.com' && url.pathname.startsWith('/emojis/')) {
    if (failEmojiDownloads) return new Response(null, { status: 404 });
    return new Response(discordAvatar, { status: 200 });
  }
  if (url.hostname === 'cdn.discordapp.com' && url.pathname === '/avatars/1/hash.png') {
    return new Response(discordAvatar, { status: 200 });
  }
  const key = decodeURIComponent(url.pathname);
  const buffer = managedBuffers.get(key);
  return buffer ? new Response(buffer, { status: 200 }) : new Response(null, { status: 404 });
};

const {
  assetPath,
  assetSource,
  clearAssetCache,
  diskCacheRootConfigurationError,
  fetchAssetBuffer,
  getAssetCacheStats,
  loadCachedImage,
  remoteAssetAvailable,
  verifyAssetDiskCacheReady,
} = require('../src/utils/assets');
const {
  takeNetworkTelemetrySnapshot,
  withNetworkContext,
} = require('../src/utils/networkTelemetry');

function fetchCount(fragment, method = 'GET') {
  return fetchCalls.filter((call) => call.startsWith(`${method} `) && call.includes(fragment)).length;
}

function cacheFiles() {
  return fs.readdirSync(cacheRoot).filter((name) => !name.startsWith('.'));
}

async function waitForDiskSweep() {
  for (let i = 0; i < 100; i += 1) {
    const stats = getAssetCacheStats();
    if (!stats.diskSweepInFlight && !stats.diskSweepForcePending) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('disk cache sweep did not settle');
}

async function rejects(fn) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  assert.match(diskCacheRootConfigurationError(process.cwd()), /project directory/);
  assert.match(diskCacheRootConfigurationError(path.parse(process.cwd()).root), /filesystem root/);
  fs.mkdirSync(unsafeRoot, { recursive: true });
  const unrelated = path.join(unsafeRoot, 'unrelated.txt');
  fs.writeFileSync(unrelated, Buffer.alloc(2 * 1024 * 1024, 7));
  const unsafeProbe = spawnSync(process.execPath, ['-e', [
    "require('./src/utils/assets').verifyAssetDiskCacheReady()",
    '  .then(() => { process.exitCode = 2; })',
    '  .catch(() => { process.exitCode = 0; });',
  ].join('\n')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      ASSET_DISK_CACHE_DIR: unsafeRoot,
      ASSET_DISK_CACHE_MAX_MB: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(unsafeProbe.status, 0, unsafeProbe.stderr || 'unsafe cache root must be rejected');
  assert.equal(fs.statSync(unrelated).size, 2 * 1024 * 1024, 'verification must not delete unrelated files');

  const ready = await verifyAssetDiskCacheReady();
  assert.equal(ready.ready, true);
  assert.equal(ready.root, cacheRoot);

  const battleUrl = assetPath('classes/battle_base/Test Image.png');
  const encodedBattleAlias = battleUrl
    .replace('cdn.example.test', 'CDN.EXAMPLE.TEST')
    .replace('/Test%20Image.png', '/%54est%20Image.png')
    .replace(/\?.*$/, '?cache=random');
  assert.equal(assetSource(encodedBattleAlias), battleUrl, 'equivalent encoded paths must canonicalize');
  assert.notEqual(
    assetSource(battleUrl.replace('/Test%20Image.png', '/test%20image.png')),
    battleUrl,
    'R2 object-key capitalization must remain case-sensitive'
  );
  assert.throws(() => assetPath('../secret.txt'), /Unsafe asset path segment/);
  assert.throws(
    () => assetSource('https://cdn.example.test/bucket/../secret.txt'),
    /Unsafe asset path segment/
  );
  assert.throws(
    () => assetSource('https://cdn.example.test/bucket/%2e%2e/secret.txt'),
    /Unsafe asset path segment/
  );
  assert.throws(
    () => assetSource('https://cdn.example.test/bucket/%2e%2e%2fsecret.txt'),
    /Unsafe asset path segment/
  );
  assert.throws(
    () => assetSource('https://cdn.example.test/bucket/safe%2f..%2fsecret.txt'),
    /Unsafe asset path segment/
  );
  const configuredVersion = process.env.ASSET_VERSION;
  process.env.ASSET_VERSION = '';
  assert.equal(
    assetSource('https://CDN.EXAMPLE.TEST/bucket/classes/battle_base/%54est%20Image.png?cache=random'),
    'https://cdn.example.test/bucket/classes/battle_base/Test%20Image.png',
    'managed R2 query aliases must canonicalize even without ASSET_VERSION'
  );
  process.env.ASSET_VERSION = configuredVersion;

  await withNetworkContext({ command: 'raid' }, async () => {
    const aliases = Array.from({ length: 12 }, (_, i) => (i % 2 ? battleUrl : encodedBattleAlias));
    const buffers = await Promise.all(aliases.map((url) => fetchAssetBuffer(url)));
    assert.ok(buffers.every((buffer) => buffer.equals(managedBuffers.get('/bucket/classes/battle_base/Test Image.png'))));
  });
  assert.equal(fetchCount('/classes/battle_base/'), 1, 'concurrent canonical aliases must share one GET');

  const cachedFiles = cacheFiles();
  assert.equal(cachedFiles.length, 1, 'the first R2 response must be written once to local disk');
  const cachedBattleFile = path.join(cacheRoot, cachedFiles[0]);
  const oldDate = new Date('2001-01-01T00:00:00Z');
  fs.utimesSync(cachedBattleFile, oldDate, oldDate);
  clearAssetCache();
  await withNetworkContext({ command: 'raid' }, () => fetchAssetBuffer(encodedBattleAlias));
  assert.equal(fetchCount('/classes/battle_base/'), 1, 'a memory-cold request must read disk without a GET');
  assert.ok(fs.statSync(cachedBattleFile).mtimeMs > oldDate.getTime(), 'disk hits must refresh LRU time');
  fs.utimesSync(cachedBattleFile, oldDate, oldDate);
  await withNetworkContext({ command: 'raid' }, () => fetchAssetBuffer(battleUrl));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(fs.statSync(cachedBattleFile).mtimeMs > oldDate.getTime(), 'memory hits must refresh disk LRU time');

  const avatarUrl = assetPath('skins/avatars/male/archer/Hero Image.png');
  const avatarAlias = avatarUrl.replace('/Hero%20Image.png', '/%48ero%20Image.png?ignored=1');
  await withNetworkContext({ command: 'stats' }, async () => {
    const images = await Promise.all(Array.from({ length: 8 }, (_, i) => (
      loadCachedImage(i % 2 ? avatarUrl : avatarAlias)
    )));
    assert.ok(images.every((image) => image.width === 16 && image.height === 16));
  });
  assert.equal(fetchCount('/skins/avatars/'), 1, 'concurrent image decodes must share one GET');
  clearAssetCache();
  await withNetworkContext({ command: 'stats' }, () => loadCachedImage(avatarAlias));
  assert.equal(fetchCount('/skins/avatars/'), 1, 'decoded images must reload from disk after memory eviction');

  const discordA = 'https://CDN.DISCORDAPP.COM/avatars/1/hash.png?size=256&format=webp';
  const discordB = 'https://cdn.discordapp.com/avatars/1/hash.png?format=webp&size=256';
  await withNetworkContext({ command: 'profile' }, async () => {
    const images = await Promise.all(Array.from({ length: 6 }, (_, i) => loadCachedImage(i % 2 ? discordA : discordB)));
    assert.ok(images.every((image) => image.width === 16));
  });
  assert.equal(fetchCount('/avatars/1/hash.png'), 1, 'Discord avatar query order must share one GET');
  clearAssetCache();
  await withNetworkContext({ command: 'profile' }, () => loadCachedImage(discordA));
  assert.equal(fetchCount('/avatars/1/hash.png'), 1, 'Discord avatars must survive memory eviction on disk');

  const missing = assetPath('skins/avatars/male/archer/missing.png');
  await withNetworkContext({ command: 'stats' }, async () => {
    assert.equal(await rejects(() => fetchAssetBuffer(missing)), true);
    assert.equal(await rejects(() => fetchAssetBuffer(missing)), true);
    assert.equal(await rejects(() => fetchAssetBuffer(missing)), true);
  });
  assert.equal(fetchCount('/missing.png'), 1, 'sequential managed 404s must use the bounded negative cache');
  managedBuffers.set('/bucket/skins/avatars/male/archer/missing.png', pngBuffer('#40b060'));
  assert.equal(
    await withNetworkContext({ command: 'stats' }, () => remoteAssetAvailable('skins/avatars/male/archer/missing.png')),
    true,
    'a newly available object must pass its HEAD check'
  );
  const recovered = await withNetworkContext({ command: 'stats' }, () => fetchAssetBuffer(missing));
  assert.ok(recovered.length > 0, 'a positive HEAD must clear the prior GET negative cache');
  assert.equal(fetchCount('/missing.png'), 2, 'the recovered object should perform one new GET');
  assert.equal(fetchCount('/missing.png', 'HEAD'), 1);

  const { getEmojiIcon, getEmojiImageCacheStats } = require('../src/engine/renderBagItems');
  await withNetworkContext({ command: 'bag' }, async () => {
    const icons = await Promise.all(Array.from({ length: 8 }, () => getEmojiIcon('combat_exp')));
    assert.ok(icons.every((image) => image?.width === 16));
  });
  assert.equal(fetchCount('/emojis/'), 1, 'concurrent Discord emoji loads must share one download');
  assert.equal(getEmojiImageCacheStats().coalesced, 7);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(await withNetworkContext({ command: 'bag' }, () => getEmojiIcon('combat_exp')));
  assert.equal(fetchCount('/emojis/'), 1, 'an expired decoded icon must reload from disk without a GET');
  const iconFile = cacheFiles().find((name) => name.startsWith('emoji-combat_exp-'));
  assert.ok(iconFile, 'Discord icon writes must use the shared disk cache');
  fs.writeFileSync(path.join(cacheRoot, iconFile), 'corrupt');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(await withNetworkContext({ command: 'bag' }, () => getEmojiIcon('combat_exp')));
  assert.equal(fetchCount('/emojis/'), 2, 'a corrupt persistent icon must be removed and downloaded once');

  failEmojiDownloads = true;
  const failedEmojiId = '1514006385426174102';
  assert.equal(await withNetworkContext({ command: 'bag' }, () => getEmojiIcon('gold_chest')), null);
  assert.equal(await withNetworkContext({ command: 'bag' }, () => getEmojiIcon('gold_chest')), null);
  assert.equal(fetchCount(failedEmojiId), 1, 'sequential missing icons must use the bounded negative cache');
  failEmojiDownloads = false;

  for (let i = 0; i < 80; i += 1) {
    managedBuffers.set(`/bucket/items/race-${i}.bin`, Buffer.alloc(70 * 1024, i));
  }
  await withNetworkContext({ command: 'bag' }, () => Promise.all(
    Array.from({ length: 80 }, (_, i) => fetchAssetBuffer(assetPath(`items/race-${i}.bin`)))
  ));
  await verifyAssetDiskCacheReady();
  await waitForDiskSweep();
  const actualFiles = cacheFiles();
  const actualBytes = actualFiles.reduce((sum, name) => sum + fs.statSync(path.join(cacheRoot, name)).size, 0);
  const settledStats = getAssetCacheStats();
  assert.ok(actualBytes <= 4 * 1024 * 1024, 'concurrent warm-up writes must remain under the disk byte cap');
  assert.equal(settledStats.diskFiles, actualFiles.length, 'disk file accounting must match the directory');
  assert.equal(settledStats.diskBytes, actualBytes, 'disk byte accounting must match the directory');
  assert.equal(
    fs.readdirSync(cacheRoot).filter((name) => name.endsWith('.tmp')).length,
    0,
    'atomic cache writes must not leave temporary files after completion'
  );

  const stats = getAssetCacheStats();
  assert.equal(stats.diskReady, true);
  assert.ok(stats.diskWrites >= 3);
  assert.ok(stats.diskHits >= 3);
  assert.ok(stats.remoteFetchNegativeHits >= 2);
  assert.ok(getEmojiImageCacheStats().negativeHits >= 1);
  const telemetry = takeNetworkTelemetrySnapshot();
  assert.ok(telemetry.interval.assetCacheByCommand.raid.diskHits >= 1);
  assert.ok(telemetry.interval.assetCacheByCommand.stats.diskHits >= 1);
  assert.ok(telemetry.interval.assetDownloadsByCommand.profile.bytes >= discordAvatar.length);
  assert.equal(
    telemetry.interval.assetDownloads.battle_backgrounds.bytes,
    managedBuffers.get('/bucket/classes/battle_base/Test Image.png').length
  );

  console.log('asset disk cache selftest passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
  fs.rmSync(unsafeRoot, { recursive: true, force: true });
});
