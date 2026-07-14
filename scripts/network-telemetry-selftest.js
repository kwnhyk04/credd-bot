'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');

process.env.ASSET_BASE_URL = 'https://cdn.example.test/bucket';
process.env.ASSET_VERSION = 'release-7';
process.env.ASSET_DISK_CACHE_ENABLED = 'false';
process.env.BANDWIDTH_LOGS = 'false';

const {
  assetSource, fetchAssetBuffer, getAssetCacheStats,
} = require('../src/utils/assets');
const {
  recordAssetCache,
  recordAssetDownload,
  recordCanvasCache,
  recordR2Upload,
  tagDiscordAttachmentBuffer,
  recordDiscordRestResponse,
  beginActivity,
  takeNetworkTelemetrySnapshot,
  withNetworkContext,
} = require('../src/utils/networkTelemetry');
const pool = require('../src/db/pool');

async function main() {
  delete process.env.ASSET_VERSION;
  assert.strictEqual(
    assetSource('https://cdn.example.test/bucket/profile/card.png?signature=keep-me'),
    'https://cdn.example.test/bucket/profile/card.png'
  );
  process.env.ASSET_VERSION = 'release-7';
  assert.strictEqual(
    assetSource('https://cdn.example.test/bucket/profile/card.png?cache=random'),
    'https://cdn.example.test/bucket/profile/card.png?v=release-7'
  );
  assert.strictEqual(
    assetSource('https://cdn.example.test/bucket/profile/card.png?v=old'),
    'https://cdn.example.test/bucket/profile/card.png?v=release-7'
  );
  assert.strictEqual(
    assetSource('https://cdn.discordapp.com/avatars/1/a.png?size=256'),
    'https://cdn.discordapp.com/avatars/1/a.png?size=256'
  );

  let fetches = 0;
  global.fetch = async () => {
    fetches += 1;
    return {
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    };
  };
  await withNetworkContext({ command: 'raid' }, async () => {
    await fetchAssetBuffer('https://cdn.example.test/bucket/items/card.png?one=1');
    await fetchAssetBuffer('https://cdn.example.test/bucket/items/card.png?two=2');
  });
  assert.strictEqual(fetches, 1, 'canonical R2 URLs should share one fetch/cache key');
  assert.strictEqual(getAssetCacheStats().bufferMisses, 1);
  assert.strictEqual(getAssetCacheStats().bufferHits, 1);

  withNetworkContext({ command: 'profile' }, () => {
    recordAssetDownload('profile', 1200, true);
    recordAssetCache('profile', 'buffer', 'coalesced');
  });
  recordCanvasCache({ command: 'profile', imageType: 'profile' }, 'memory');
  recordCanvasCache({ command: 'profile', imageType: 'coalesced' }, 'coalesced');
  recordR2Upload({ command: 'raid', imageType: 'battle_frame' }, 2400, true);
  let responseBodyCancelled = false;
  const profileAttachment = Buffer.alloc(600);
  tagDiscordAttachmentBuffer(profileAttachment, { command: 'profile', imageType: 'profile' });
  recordDiscordRestResponse({
    route: '/channels/:id/messages',
    data: {
      body: { content: 'ok' },
      files: [{ name: 'profile-1.webp', data: profileAttachment }],
    },
  }, {
    ok: true,
    headers: { get: () => '80' },
    body: {
      cancel: () => {
        responseBodyCancelled = true;
        return Promise.resolve();
      },
    },
  });
  assert.strictEqual(responseBodyCancelled, true);
  const end = beginActivity('battle.raid');
  end();

  const first = takeNetworkTelemetrySnapshot();
  assert.strictEqual(first.interval.assetDownloads.profile.bytes, 1200);
  assert.strictEqual(first.interval.assetCache.equipment_assets.bufferHits, 1);
  assert.strictEqual(first.interval.assetCache.equipment_assets.bufferMisses, 1);
  assert.strictEqual(first.interval.assetCacheByCommand.raid.bufferHits, 1);
  assert.strictEqual(first.interval.assetCacheByCommand.raid.bufferMisses, 1);
  assert.strictEqual(first.interval.assetCache.profile.bufferCoalesced, 1);
  assert.strictEqual(first.interval.assetCacheByCommand.profile.bufferCoalesced, 1);
  assert.strictEqual(first.interval.assetDownloadsByCommand.profile.bytes, 1200);
  assert.strictEqual(first.interval.canvasCache.profile.memoryHits, 1);
  assert.strictEqual(first.interval.canvasCache['profile.coalesced'].inflightHits, 1);
  assert.strictEqual(first.interval.r2Uploads['raid.battle_frame'].confirmedBytes, 2400);
  assert.strictEqual(first.interval.discordAttachmentsByCommand.profile.confirmedBytes, 600);
  assert.strictEqual(first.interval.discordAttachmentsByFilenameCategory.profile.confirmedBytes, 600);
  assert.strictEqual(first.interval.discordRest.messages.requestBytes, 16);
  assert.strictEqual(first.interval.discordRest.messages.responseBytes, 80);
  assert.strictEqual(first.total.activities['battle.raid'].active, 0);
  assert.strictEqual(first.total.activities['battle.raid'].completed, 1);

  recordAssetDownload('profile', 25, true);
  const second = takeNetworkTelemetrySnapshot();
  assert.strictEqual(second.interval.assetDownloads.profile.bytes, 25);
  assert.strictEqual(second.interval.r2Uploads['raid.battle_frame'].confirmedBytes, 0);
  assert.strictEqual(second.interval.discordAttachmentsByCommand.profile.confirmedBytes, 0);
  assert.strictEqual(second.interval.discordAttachmentsByFilenameCategory.profile.confirmedBytes, 0);

  const third = takeNetworkTelemetrySnapshot();
  assert.strictEqual(third.interval.assetDownloads.profile.bytes, 0);

  for (let i = 0; i < 100; i += 1) recordAssetDownload(`bounded-${i}`, 1, true);
  const bounded = takeNetworkTelemetrySnapshot();
  assert.strictEqual(Object.keys(bounded.total.assetDownloads).length, 64);
  assert.ok(bounded.total.assetDownloads.other, 'overflow counters should share the reserved other key');

  const socket = new EventEmitter();
  socket.bytesRead = 900;
  socket.bytesWritten = 300;
  const beforePg = pool.getNetworkStats();
  pool.emit('connect', { connection: { stream: socket } });
  const connectedPg = pool.getNetworkStats();
  assert.strictEqual(connectedPg.bytesRead - beforePg.bytesRead, 900);
  assert.strictEqual(connectedPg.bytesWritten - beforePg.bytesWritten, 300);
  socket.bytesRead = 1200;
  socket.bytesWritten = 450;
  socket.emit('close');
  const closedPg = pool.getNetworkStats();
  assert.strictEqual(closedPg.bytesRead - beforePg.bytesRead, 1200);
  assert.strictEqual(closedPg.bytesWritten - beforePg.bytesWritten, 450);

  console.log('network telemetry selftest passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
