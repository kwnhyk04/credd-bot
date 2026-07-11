'use strict';

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
  await renderProfileLayoutImage(data, options);
  await renderStatsLayoutImage(data, options);
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
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const idle = snapshot('idle-1s');
  const growthMb = idle.rssMb - repeated.rssMb;
  if (growthMb > 160) {
    throw new Error(`RSS kept growing after warm-up by ${growthMb} MB`);
  }
  console.log(JSON.stringify({ status: 'passed', baselineRssMb: baseline.rssMb, peakRssMb: concurrent.rssMb, warmGrowthMb: growthMb }));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
