'use strict';

const fs = require('fs');
const path = require('path');
const { renderProfileLayoutImage } = require('../src/engine/profileLayoutRenderer');
const { renderStatsLayoutImage } = require('../src/engine/statsLayoutRenderer');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tmp', 'requested-preview');
const skinPath = path.join(ROOT, 'assets', 'skins', 'founder', 'founder_profile.png');
const avatarPath = path.join(ROOT, 'assets', 'classes', 'knight.png');
const badgePath = process.env.SUPPORTER_BADGE_PREVIEW_PATH
  || path.join(ROOT, 'assets', 'items', 'valor_medal.png');

const data = {
  discordId: 'preview',
  displayName: 'Maximiliana Everflame',
  equippedTitle: '',
  believerLevel: 50,
  believerTitle: 'Eternal Founder',
  profileTitle: 'Eternal Founder',
  believerExp: 2745,
  believerExpMax: 3000,
  className: 'Knight',
  combatLevel: 50,
  combatExp: 2300,
  combatExpMax: 2400,
  weaponName: 'Thunderbolt of Zeus',
  weaponEnh: 10,
  armorName: 'Mail of Brokkr',
  armorEnh: 10,
  deityName: 'Odin',
  deityEnh: 10,
  blessingName: 'All-Father\'s Foresight',
  atk: 9999,
  hp: 99999,
  def: 9999,
  crit: 45,
  records: { raids: 999, raidsWon: 888, raidStreak: 99, duels: 777, duelWins: 666, duelStreak: 88 },
  topLabel: { hasTopLabel: true, word: 'Founder 001' },
  quote: 'The gods remember your name.',
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const options = { skinPath, avatarPath, supporterBadgePath: badgePath };
  const [profile, stats] = await Promise.all([
    renderProfileLayoutImage(data, options),
    renderStatsLayoutImage(data, options),
  ]);
  const profilePath = path.join(OUT, 'founder-profile.png');
  const statsPath = path.join(OUT, 'founder-stats.png');
  fs.writeFileSync(profilePath, profile);
  fs.writeFileSync(statsPath, stats);
  console.log(profilePath);
  console.log(statsPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
