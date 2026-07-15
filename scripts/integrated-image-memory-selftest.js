'use strict';

process.env.ASSET_BASE_URL = '';
process.env.BANDWIDTH_LOGS = 'false';
process.env.PERFORMANCE_LOGS = 'false';
process.env.RESOURCE_LOGS = 'false';

const path = require('node:path');
const { SUITS, RANKS } = require('../src/casino/cardDeck');
const { cardStrip, getCasinoCanvasCacheStats } = require('../src/casino/casinoCanvas');
const { renderProfileLayoutImage } = require('../src/engine/profileLayoutRenderer');
const { renderStatsLayoutImage } = require('../src/engine/statsLayoutRenderer');
const { getAssetCacheStats } = require('../src/utils/assets');

const ROOT = path.join(__dirname, '..');
const skinPath = path.join(ROOT, 'assets', 'skins', 'founder', 'founder_profile.png');
const badgePath = path.join(ROOT, 'assets', 'items', 'valor_medal.png');
const avatars = ['swordsman', 'fighter', 'mage', 'knight', 'archer']
  .map((name) => path.join(ROOT, 'assets', 'classes', `${name}.png`));
const data = {
  discordId: 'integrated-memory-test',
  displayName: 'Integrated Memory Test',
  equippedTitle: 'Renderer High Water',
  believerLevel: 50,
  believerTitle: 'Eternal Founder',
  profileTitle: 'Eternal Founder',
  believerExp: 2500,
  believerExpMax: 3000,
  className: 'Knight',
  combatLevel: 50,
  combatExp: 2000,
  combatExpMax: 3000,
  weaponName: null,
  armorName: null,
  deityName: null,
  atk: 1000,
  hp: 10000,
  def: 800,
  crit: 10,
  records: { raids: 10, raidsWon: 8, raidStreak: 2, duels: 5, duelWins: 3, duelStreak: 1 },
  topLabel: { hasTopLabel: true, word: 'Founder 001' },
  quote: 'Measure the combined renderer high water.',
};

function mb(value) {
  return Math.round((Number(value) || 0) / 1024 / 1024);
}

function snapshot(phase) {
  const memory = process.memoryUsage();
  const assets = getAssetCacheStats();
  const casino = getCasinoCanvasCacheStats();
  return {
    phase,
    rssMb: mb(memory.rss),
    heapUsedMb: mb(memory.heapUsed),
    externalMb: mb(memory.external),
    arrayBuffersMb: mb(memory.arrayBuffers),
    assetEntries: assets.entries,
    assetMb: mb(assets.bytes),
    casinoFaceEntries: casino.faceEntries,
    casinoFaceMb: mb(casino.faceBytes),
  };
}

async function main() {
  const samples = [snapshot('baseline')];
  const originalLog = console.log;
  console.log = () => {};
  try {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        await cardStrip([{ suit, rank }]);
      }
    }
    samples.push(snapshot('all-52-card-faces'));

    for (let index = 0; index < 20; index += 1) {
      const options = {
        skinPath,
        avatarPath: avatars[index % avatars.length],
        supporterBadgePath: badgePath,
        iconPaths: { combatExp: badgePath },
      };
      await renderProfileLayoutImage(data, options);
      await renderStatsLayoutImage(data, options);
    }
  } finally {
    console.log = originalLog;
  }

  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const idle = snapshot('idle-after-92-images');
  samples.push(idle);
  if (idle.rssMb >= 400) {
    throw new Error(`Integrated renderer RSS exceeded the 400 MB target: ${JSON.stringify(samples)}`);
  }
  console.log(JSON.stringify({ status: 'passed', targetRssMb: 400, samples }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
