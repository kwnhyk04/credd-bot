'use strict';

/**
 * Render a profile skin with its colocated layout through the production renderer.
 *
 *   node scripts/renderSkinDesignPreview.js <skin.png> [output.png]
 */

const fs = require('fs');
const path = require('path');
const { renderProfileLayoutImage } = require('../src/engine/profileLayoutRenderer');

const ROOT = path.join(__dirname, '..');
const DEFAULT_SKIN = path.join(
  ROOT, 'assets', 'skins', 'supporters', 'supporter_store', 'profile', 'c_divine_radiance_p1.png'
);

const SAMPLE = {
  displayName: 'Maximiliana Everflame',
  believerLevel: 50,
  believerTitle: 'Zealot',
  profileTitle: 'Eternal Founder',
  believerExp: 2745,
  believerExpMax: 3000,
  className: 'Swordsman',
  combatLevel: 50,
  combatExp: 14750000,
  combatExpMax: null,
  weaponName: 'Thunderbolt of Zeus',
  weaponEnh: 10,
  deityName: 'Zeus',
  deityEnh: 10,
  blessingName: 'Thunder Sovereign',
  atk: 9999,
  hp: 99999,
  def: 9999,
  crit: 45,
  records: {
    raids: 999,
    raidsWon: 888,
    raidStreak: 99,
    duels: 777,
    duelWins: 666,
    duelStreak: 88,
  },
  topLabel: { hasTopLabel: true, word: 'Founder 000' },
  quote: '"Faith is the only blade that never dulls."',
};

async function main() {
  const skinPath = path.resolve(process.argv[2] || DEFAULT_SKIN);
  const stem = path.basename(skinPath).replace(/\.[^.]+$/, '');
  const parent = path.basename(path.dirname(skinPath));
  const outputName = parent === 'profile'
    ? `profile__${stem}.png`
    : `profile__${parent}__${stem}.png`;
  const outPath = path.resolve(
    process.argv[3] || path.join(ROOT, 'tmp', 'skin_preview', outputName)
  );
  const cacheDir = path.join(ROOT, 'assets', 'cache', 'emojis');
  const buffer = await renderProfileLayoutImage(SAMPLE, {
    skinPath,
    avatarPath: path.join(ROOT, 'assets', 'classes', 'swordsman.png'),
    iconPaths: {
      weapon: path.join(cacheDir, 'thunderbolt.png'),
      deity: path.join(cacheDir, 'zeus.png'),
      combatExp: path.join(cacheDir, 'combat_exp.png'),
    },
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);
  console.log(outPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
