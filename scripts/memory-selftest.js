'use strict';

process.env.RESOURCE_LOGS = 'false';

const path = require('path');
const { renderProfileLayoutImage } = require('../src/engine/profileLayoutRenderer');
const { renderStatsLayoutImage } = require('../src/engine/statsLayoutRenderer');
const { getAssetCacheStats } = require('../src/utils/assets');
const { withImageWorkSlot } = require('../src/utils/imageWorkQueue');

const ROOT = path.join(__dirname, '..');
const skinPath = path.join(ROOT, 'assets', 'skins', 'founder', 'founder_profile.png');
const badgePath = path.join(ROOT, 'assets', 'items', 'valor_medal.png');
const avatars = ['swordsman', 'fighter', 'mage', 'knight', 'archer']
  .map((name) => path.join(ROOT, 'assets', 'classes', `${name}.png`));
const data = {
  discordId: 'memory-test', displayName: 'Memory Test', equippedTitle: 'Long-Running Render Test',
  believerLevel: 50, believerTitle: 'Eternal Founder', profileTitle: 'Eternal Founder',
  believerExp: 2500, believerExpMax: 3000, className: 'Knight', combatLevel: 50,
  combatExp: 2000, combatExpMax: 3000, weaponName: null, armorName: null, deityName: null,
  atk: 1000, hp: 10000, def: 800, crit: 10,
  records: { raids: 10, raidsWon: 8, raidStreak: 2, duels: 5, duelWins: 3, duelStreak: 1 },
  topLabel: { hasTopLabel: true, word: 'Founder 001' }, quote: 'Memory remains bounded.',
};
const generatedBufferRefs = [];

function snapshot(phase) {
  const mem = process.memoryUsage();
  const mb = (value) => Math.round(value / 1024 / 1024);
  const assets = getAssetCacheStats();
  const row = {
    phase,
    rssMb: mb(mem.rss),
    heapUsedMb: mb(mem.heapUsed),
    externalMb: mb(mem.external),
    arrayBuffersMb: mb(mem.arrayBuffers),
    assetEntries: assets.entries,
    assetMb: mb(assets.bytes),
  };
  console.log(JSON.stringify(row));
  return row;
}

async function renderPair(index) {
  const options = {
    skinPath,
    avatarPath: avatars[index % avatars.length],
    supporterBadgePath: badgePath,
  };
  let output = await renderProfileLayoutImage(data, options);
  generatedBufferRefs.push(new WeakRef(output));
  output = await renderStatsLayoutImage(data, options);
  generatedBufferRefs.push(new WeakRef(output));
  output = null;
}

async function main() {
  const baseline = snapshot('baseline');
  await renderPair(0);
  snapshot('cold-render');
  for (let i = 0; i < 50; i++) await renderPair(i);
  const repeated = snapshot('100-sequential-images');
  for (let batch = 0; batch < 2; batch++) {
    await Promise.all(Array.from({ length: 4 }, (_, i) =>
      withImageWorkSlot('memory-selftest', () => renderPair(batch * 4 + i))
    ));
  }
  const concurrent = snapshot('16-queued-concurrent-images');
  // Settle-poll instead of a fixed 1s sleep: the renderer's quiescent native
  // cache clear fires 1s after the last render, and V8's external-pressure GC
  // collects the canvas wrappers shortly after idle begins. A snapshot taken at
  // exactly 1000ms races both mechanisms and can read the pre-release plateau
  // (~505 MB / 365 MB external) that fully collapses ~1.5s later. A sample is
  // settled when renderer-owned external memory has returned to a small
  // baseline OR RSS is under the target — RSS alone is not portable because
  // some allocators retain freed pages. Two consecutive settled samples are
  // required so a single transient reading cannot pass; never observing two
  // within 15s always fails, independent of the final memory values.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isSettled = (row) => row.externalMb < 10 || row.rssMb < 350;
  await sleep(1000);
  let idle = snapshot('idle-1s');
  const settleStarted = Date.now();
  let consecutiveSettledSamples = 0;
  while (Date.now() - settleStarted < 15_000) {
    idle = snapshot('idle-settling');
    if (isSettled(idle)) {
      consecutiveSettledSamples += 1;
    } else {
      consecutiveSettledSamples = 0;
    }
    if (consecutiveSettledSamples >= 2) {
      break;
    }
    await sleep(500);
  }
  const externalSettled = idle.externalMb < 10;
  const rssSettled = idle.rssMb < 350;
  const timedOut = consecutiveSettledSamples < 2;
  const settleReason =
    timedOut
      ? 'timeout'
      : externalSettled && rssSettled
        ? 'external+rss'
        : externalSettled
          ? 'external'
          : 'rss';
  idle.phase = 'idle-settled';
  idle.settleMs = 1000 + (Date.now() - settleStarted);
  idle.settleReason = settleReason;
  idle.timedOut = timedOut;
  const growthMb = idle.rssMb - repeated.rssMb;
  if (growthMb > 160) {
    throw new Error(`RSS kept growing after warm-up by ${growthMb} MB`);
  }
  if (timedOut) {
    throw new Error(
      `Idle settle timed out after ${idle.settleMs} ms without two consecutive settled samples `
      + `(settled = external < 10 MB or RSS < 350 MB): rss ${idle.rssMb} MB, external ${idle.externalMb} MB`
    );
  }
  let collected = idle;
  if (typeof global.gc === 'function') {
    global.gc();
    await new Promise((resolve) => setImmediate(resolve));
    global.gc();
    collected = snapshot('forced-gc');
    const reachableGeneratedBuffers = generatedBufferRefs.reduce(
      (count, ref) => count + (ref.deref() ? 1 : 0),
      0
    );
    if (reachableGeneratedBuffers !== 0) {
      throw new Error(`${reachableGeneratedBuffers} generated image buffers remained reachable after GC`);
    }
    collected.reachableGeneratedBuffers = reachableGeneratedBuffers;
  }
  console.log(JSON.stringify({
    status: 'passed',
    baselineRssMb: baseline.rssMb,
    peakRssMb: concurrent.rssMb,
    steadyRssMb: idle.rssMb,
    collectedRssMb: collected.rssMb,
    collectedArrayBuffersMb: collected.arrayBuffersMb,
    reachableGeneratedBuffers: collected.reachableGeneratedBuffers ?? null,
    targetRssMb: 350,
    warmGrowthMb: growthMb,
    settleReason: idle.settleReason,
    settleMs: idle.settleMs,
  }));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
