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
  // (~505 MB / 365 MB external) that fully collapses ~1.5s later. Poll until
  // RSS stabilizes (or 15s worst case), then judge steady state.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await sleep(1000);
  let idle = snapshot('idle-1s');
  const settleStarted = Date.now();
  while (idle.rssMb > 350 && Date.now() - settleStarted < 15_000) {
    await sleep(500);
    idle = snapshot('idle-settling');
  }
  idle.phase = 'idle-settled';
  idle.settleMs = 1000 + (Date.now() - settleStarted);
  const growthMb = idle.rssMb - repeated.rssMb;
  if (growthMb > 160) {
    throw new Error(`RSS kept growing after warm-up by ${growthMb} MB`);
  }
  if (idle.rssMb > 350) {
    throw new Error(`Steady-state RSS exceeded the 350 MB target: ${idle.rssMb} MB`);
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
  }));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
