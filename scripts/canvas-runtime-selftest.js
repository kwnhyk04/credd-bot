'use strict';

const assert = require('node:assert/strict');

process.env.RESOURCE_LOGS = 'false';
process.env.CASINO_CARD_FACE_CACHE_MAX = '1';

const imageRuntime = require('../src/utils/imageRuntime');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { encodeCanvas, releaseCanvas } = require('../src/utils/canvasEncode');
const {
  cardStrip,
  clearCasinoCanvasCache,
  getCasinoCanvasCacheStats,
} = require('../src/casino/casinoCanvas');

async function assertCardStripGeometry(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const image = await loadImage(buffer);
  assert.equal(image.width, 460);
  assert.equal(image.height, 110);
  const canvas = createCanvas(image.width, image.height);
  try {
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    let minX = image.width, minY = image.height, maxX = -1, maxY = -1;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (data[(y * image.width + x) * 4 + 3] > 12) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    assert(maxX > minX && maxY > minY, 'card strip must contain visible pixels');
    assert(minX >= 197 && minX <= 199, `unexpected card left edge: ${minX}`);
    assert(maxX >= 260 && maxX <= 262, `unexpected card right edge: ${maxX}`);
    assert(minY >= 9 && minY <= 11, `unexpected card top edge: ${minY}`);
    assert(maxY >= 98 && maxY <= 100, `unexpected card bottom edge: ${maxY}`);
  } finally {
    releaseCanvas(canvas);
  }
}

async function main() {
  const baseline = imageRuntime.getCanvasRuntimeStats();

  const tracked = createCanvas(100, 50);
  let stats = imageRuntime.getCanvasRuntimeStats();
  assert.equal(stats.createdCanvases, baseline.createdCanvases + 1);
  assert.equal(stats.activeCanvases, baseline.activeCanvases + 1);
  assert.equal(stats.activePixelBytes, baseline.activePixelBytes + (100 * 50 * 4));
  assert.equal(releaseCanvas(tracked), true);
  stats = imageRuntime.getCanvasRuntimeStats();
  assert.equal(stats.activeCanvases, baseline.activeCanvases);
  assert.equal(stats.activePixelBytes, baseline.activePixelBytes);

  const encoded = createCanvas(64, 32);
  encoded.getContext('2d').fillRect(0, 0, 64, 32);
  const encodedBuffer = encodeCanvas(encoded);
  assert(encodedBuffer.length > 0);
  assert.equal(imageRuntime.getCanvasRuntimeStats().activeCanvases, baseline.activeCanvases);

  // Clearing Skia's process cache must not invalidate a live canvas retained by a renderer cache.
  const retained = createCanvas(32, 32);
  retained.getContext('2d').fillRect(0, 0, 32, 32);
  assert.equal(imageRuntime.flushCanvasNativeCache(), true);
  assert(retained.toBuffer('image/png').length > 0);
  releaseCanvas(retained);

  const first = await cardStrip([{ suit: 'hammer', rank: '2' }]);
  assert(first.length > 0);
  await assertCardStripGeometry(first);
  let casinoStats = getCasinoCanvasCacheStats();
  assert.equal(casinoStats.missingAssetEntries, 0, 'representative card sources must not fall back');
  assert.equal(casinoStats.faceEntries, 1);
  assert.equal(casinoStats.faceLeases, 0);
  const releasedBeforeEviction = casinoStats.faceReleasedCanvases;

  const second = await cardStrip([{ suit: 'laurel', rank: '3' }]);
  assert(second.length > 0);
  await assertCardStripGeometry(second);
  casinoStats = getCasinoCanvasCacheStats();
  assert.equal(casinoStats.faceEntries, 1);
  assert.equal(casinoStats.faceLeases, 0);
  assert(casinoStats.faceReleasedCanvases > releasedBeforeEviction);

  clearCasinoCanvasCache();
  casinoStats = getCasinoCanvasCacheStats();
  assert.equal(casinoStats.faceEntries, 0);
  assert.equal(casinoStats.faceBytes, 0);
  assert.equal(casinoStats.faceLeases, 0);

  imageRuntime.flushCanvasNativeCache();
  stats = imageRuntime.getCanvasRuntimeStats();
  assert.equal(stats.activeCanvases, baseline.activeCanvases);
  assert(stats.explicitReleases >= baseline.explicitReleases + 9);
  assert(stats.nativeCacheClears >= baseline.nativeCacheClears + 2);

  console.log(JSON.stringify({ ok: true, canvas: stats, casino: casinoStats }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
