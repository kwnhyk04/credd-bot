'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');

process.env.ASSET_BASE_URL = 'https://cdn.example.test/bucket';
process.env.ASSET_VERSION = 'release-7';
process.env.ASSET_DISK_CACHE_ENABLED = 'false';
process.env.BANDWIDTH_LOGS = 'false';
process.env.RESOURCE_LOGS = 'true';
delete process.env.RESOURCE_LOG_INTERVAL_MS;

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
  normalizePhase,
  takeNetworkTelemetrySnapshot,
  withNetworkContext,
} = require('../src/utils/networkTelemetry');
const { withImageWorkSlot } = require('../src/utils/imageWorkQueue');
const { resourceLogIntervalMs } = require('../src/utils/resourceMonitor');
const { createCanvas } = require('@napi-rs/canvas');
const { encodeCanvas } = require('../src/utils/canvasEncode');
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
  const rawUserId = '123456789012345678';
  const rawRequestId = '987654321098765432';
  const profileAttachment = Buffer.alloc(600, 1);
  const updateAttachment = Buffer.alloc(100, 2);
  const finalAttachment = Buffer.alloc(50, 3);
  const uploadLines = [];
  let responseBodiesCancelled = 0;
  const originalLog = console.log;
  console.log = (...args) => {
    const line = args.join(' ');
    if (line.startsWith('[discord-upload] ')) uploadLines.push(line);
    else originalLog(...args);
  };
  try {
    withNetworkContext({
      command: 'profile',
      surface: 'slash',
      phase: 'final',
      userId: rawUserId,
      interactionId: rawRequestId,
    }, () => {
      tagDiscordAttachmentBuffer(profileAttachment, { imageType: 'profile', phase: 'start' });
      tagDiscordAttachmentBuffer(updateAttachment, { imageType: 'battle_frame', phase: 'update' });
      tagDiscordAttachmentBuffer(finalAttachment, { imageType: 'profile_result', phase: 'final' });
      const request = {
        method: 'post',
        route: `/channels/${rawRequestId}/messages`,
        data: {
          body: { content: 'ok' },
          files: [
            { name: `profile-${rawUserId}.webp`, data: profileAttachment },
            { name: `battle-${rawUserId}.webp`, data: updateAttachment },
            { name: `result-${rawUserId}.webp`, data: finalAttachment },
          ],
        },
      };
      const response = (ok, status) => ({
        ok,
        status,
        headers: { get: () => '80' },
        body: {
          cancel: () => {
            responseBodiesCancelled += 1;
            return Promise.resolve();
          },
        },
      });
      recordDiscordRestResponse({ ...request, retries: 0 }, response(false, 503));
      recordDiscordRestResponse({ ...request, retries: 1 }, response(true, 200));
    });
  } finally {
    console.log = originalLog;
  }
  assert.strictEqual(responseBodiesCancelled, 2);
  assert.strictEqual(uploadLines.length, 6, 'each attachment attempt/retry should emit one upload event');
  assert.ok(uploadLines.every((line) => !line.includes(rawUserId) && !line.includes(rawRequestId)), 'upload logs must not contain raw snowflakes');
  const uploadEvents = uploadLines.map((line) => JSON.parse(line.slice('[discord-upload] '.length)));
  const initialFailure = uploadEvents.find((event) => event.phase === 'initial' && event.status === 503);
  const initialSuccess = uploadEvents.find((event) => event.phase === 'initial' && event.status === 200);
  const intermediateSuccess = uploadEvents.find((event) => event.phase === 'intermediate' && event.status === 200);
  const finalSuccess = uploadEvents.find((event) => event.phase === 'final' && event.status === 200);
  assert.ok(initialFailure && initialSuccess && intermediateSuccess && finalSuccess);
  assert.strictEqual(initialFailure.uploadIndex, 1);
  assert.strictEqual(initialFailure.uploadCount, 3);
  assert.strictEqual(initialFailure.retry, 0);
  assert.strictEqual(initialSuccess.retry, 1);
  assert.strictEqual(initialFailure.duplicateBuffer, false);
  assert.strictEqual(initialSuccess.duplicateBuffer, true);
  assert.strictEqual(initialFailure.fingerprint, initialSuccess.fingerprint);
  assert.strictEqual(initialFailure.surface, 'slash');
  assert.match(initialFailure.userHash, /^[a-f0-9]{16}$/);
  assert.match(initialFailure.correlationId, /^[a-f0-9]{16}$/);
  assert.ok(initialFailure.filename.includes('{id}'));
  assert.ok(initialFailure.route.includes(':id'));
  assert.strictEqual(intermediateSuccess.uploadIndex, 2);
  assert.strictEqual(finalSuccess.uploadIndex, 3);
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
  assert.strictEqual(first.interval.r2Reads.get.bytes, 4);
  assert.strictEqual(first.interval.r2ReadsByCommand.raid.bytes, 4);
  assert.strictEqual(first.interval.canvasCache.profile.memoryHits, 1);
  assert.strictEqual(first.interval.canvasCache['profile.coalesced'].inflightHits, 1);
  assert.strictEqual(first.interval.r2Uploads['raid.battle_frame'].confirmedBytes, 2400);
  assert.strictEqual(first.interval.discordAttachmentsByCommand.profile.confirmedBytes, 750);
  assert.strictEqual(first.interval.discordAttachmentsByCommand.profile.attemptedBytes, 1500);
  assert.strictEqual(first.interval.discordAttachmentsByCommand.profile.duplicateAttempts, 3);
  assert.strictEqual(first.interval.discordAttachmentsByCommandPhase['profile.initial'].confirmedBytes, 600);
  assert.strictEqual(first.interval.discordAttachmentsByCommandPhase['profile.intermediate'].confirmedBytes, 100);
  assert.strictEqual(first.interval.discordAttachmentsByCommandPhase['profile.final'].confirmedBytes, 50);
  assert.strictEqual(first.interval.discordAttachmentsByFilenameCategory.profile.confirmedBytes, 600);
  assert.strictEqual(first.interval.discordRest.messages.requestBytes, 32);
  assert.strictEqual(first.interval.discordRest.messages.responseBytes, 160);
  assert.strictEqual(first.total.activities['battle.raid'].active, 0);
  assert.strictEqual(first.total.activities['battle.raid'].completed, 1);

  recordAssetDownload('profile', 25, true);
  const second = takeNetworkTelemetrySnapshot();
  assert.strictEqual(second.interval.assetDownloads.profile.bytes, 25);
  assert.strictEqual(second.interval.r2Uploads['raid.battle_frame'].confirmedBytes, 0);
  assert.strictEqual(second.interval.discordAttachmentsByCommand.profile.confirmedBytes, 0);
  assert.strictEqual(second.interval.discordAttachmentsByCommandPhase['profile.final'].confirmedBytes, 0);
  assert.strictEqual(second.interval.discordAttachmentsByFilenameCategory.profile.confirmedBytes, 0);

  const third = takeNetworkTelemetrySnapshot();
  assert.strictEqual(third.interval.assetDownloads.profile.bytes, 0);

  for (let i = 0; i < 100; i += 1) recordAssetDownload(`bounded-${i}`, 1, true);
  const bounded = takeNetworkTelemetrySnapshot();
  assert.strictEqual(Object.keys(bounded.total.assetDownloads).length, 64);
  assert.ok(bounded.total.assetDownloads.other, 'overflow counters should share the reserved other key');

  const rendererLines = [];
  console.log = (...args) => {
    const line = args.join(' ');
    if (line.startsWith('[renderer-memory] ')) rendererLines.push(line);
    else originalLog(...args);
  };
  try {
    await withNetworkContext({
      command: 'stats', surface: 'slash', phase: 'final', userId: rawUserId, interactionId: rawRequestId,
    }, async () => {
      await withImageWorkSlot('stats', async () => Buffer.alloc(16), { userId: rawUserId });
      const canvas = createCanvas(16, 16);
      canvas.getContext('2d').fillRect(0, 0, 16, 16);
      encodeCanvas(canvas);
    });
  } finally {
    console.log = originalLog;
  }
  assert.strictEqual(rendererLines.length, 2);
  assert.ok(rendererLines.every((line) => !line.includes(rawUserId) && !line.includes(rawRequestId)));
  const rendererEvents = rendererLines.map((line) => JSON.parse(line.slice('[renderer-memory] '.length)));
  const rendererEvent = rendererEvents.find((event) => event.kind !== 'canvas-lifecycle');
  const canvasEvent = rendererEvents.find((event) => event.kind === 'canvas-lifecycle');
  assert.ok(rendererEvent && canvasEvent, 'queue and raw Canvas lifecycles must both be bracketed');
  assert.strictEqual(rendererEvent.command, 'stats');
  assert.strictEqual(rendererEvent.phase, 'final');
  for (const field of ['rss', 'external', 'arrayBuffers', 'nativeGapEstimate']) {
    assert.ok(Number.isFinite(rendererEvent.before[field]), `renderer before.${field} missing`);
    assert.ok(Number.isFinite(rendererEvent.after[field]), `renderer after.${field} missing`);
    assert.ok(Number.isFinite(rendererEvent.delta[field]), `renderer delta.${field} missing`);
  }
  assert.strictEqual(canvasEvent.command, 'stats');
  assert.strictEqual(canvasEvent.width, 16);
  assert.strictEqual(canvasEvent.height, 16);
  assert.ok(canvasEvent.renderer.includes('network-telemetry-selftest.js'));
  for (const field of ['rss', 'external', 'arrayBuffers', 'nativeGapEstimate']) {
    assert.ok(Number.isFinite(canvasEvent.before[field]), `canvas before.${field} missing`);
    assert.ok(Number.isFinite(canvasEvent.after[field]), `canvas after.${field} missing`);
    assert.ok(Number.isFinite(canvasEvent.lifetimeDelta[field]), `canvas lifetimeDelta.${field} missing`);
  }

  assert.strictEqual(resourceLogIntervalMs(), 300_000);
  assert.strictEqual(normalizePhase('spawn'), 'initial');
  assert.strictEqual(normalizePhase('snapshot'), 'final');
  process.env.RESOURCE_LOG_INTERVAL_MS = '600000';
  assert.strictEqual(resourceLogIntervalMs(), 300_000, 'stale 10-minute interval must clamp to five minutes');
  process.env.RESOURCE_LOG_INTERVAL_MS = '120000';
  assert.strictEqual(resourceLogIntervalMs(), 120_000, 'shorter monitoring intervals remain allowed');
  process.env.RESOURCE_LOG_INTERVAL_MS = '1';
  assert.strictEqual(resourceLogIntervalMs(), 60_000, 'diagnostic cadence must retain a production-safe floor');
  delete process.env.RESOURCE_LOG_INTERVAL_MS;

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
