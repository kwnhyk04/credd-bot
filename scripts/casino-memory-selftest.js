'use strict';

process.env.ASSET_BASE_URL = '';
process.env.PERFORMANCE_LOGS = 'false';
process.env.BANDWIDTH_LOGS = 'false';

const { SUITS, RANKS } = require('../src/casino/cardDeck');
const { cardStrip, getCasinoCanvasCacheStats } = require('../src/casino/casinoCanvas');
const { getAssetCacheStats } = require('../src/utils/assets');

function mb(value) {
  return Math.round((Number(value) || 0) / 1024 / 1024);
}

async function main() {
  const before = process.memoryUsage();
  const originalLog = console.log;
  console.log = () => {};
  try {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        let output = await cardStrip([{ suit, rank }]);
        output = null;
      }
    }
  } finally {
    console.log = originalLog;
  }

  if (typeof global.gc === 'function') {
    global.gc();
    await new Promise((resolve) => setImmediate(resolve));
    global.gc();
  }

  const after = process.memoryUsage();
  const faces = getCasinoCanvasCacheStats();
  const assets = getAssetCacheStats();
  const result = {
    status: 'passed',
    baselineRssMb: mb(before.rss),
    finalRssMb: mb(after.rss),
    externalMb: mb(after.external),
    arrayBuffersMb: mb(after.arrayBuffers),
    faceEntries: faces.faceEntries,
    faceMb: mb(faces.faceBytes),
    faceMaxEntries: faces.faceMaxEntries,
    faceMaxMb: mb(faces.faceMaxBytes),
    assetEntries: assets.entries,
    assetMb: mb(assets.bytes),
    assetMaxMb: mb(assets.maxBytes),
  };

  if (faces.faceEntries > faces.faceMaxEntries || faces.faceBytes > faces.faceMaxBytes) {
    throw new Error(`Casino face cache exceeded its bound: ${JSON.stringify(result)}`);
  }
  if (assets.bytes > assets.maxBytes) {
    throw new Error(`Asset cache exceeded its byte bound: ${JSON.stringify(result)}`);
  }
  if (result.finalRssMb > 350) {
    throw new Error(`Casino steady-state RSS exceeded the 350 MB target: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
