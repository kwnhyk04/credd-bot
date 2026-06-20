'use strict';

const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'tmp', 'skin_preview');
const OUT = path.join(DIR, 'profile_canvas_review_sheet.png');
const TILE_W = 720;
const IMAGE_H = 480;
const LABEL_H = 44;
const GAP = 16;
const COLS = 2;

const entries = [
  ['P1 - Divine Radiance', 'profile__c_divine_radiance_p1.png'],
  ['P2 - Laurel Runes Blue', 'profile__c_laurel_runes_blue_p2.png'],
  ['P3 - Aurora Constellation', 'profile__e_aurora_constellation_p3.png'],
  ['P4 - Eternal Flame', 'profile__e_eternal_flame_p4.png'],
  ['Tester Default', 'profile__testers__profile.png'],
  ['Tester 732560805006016523', 'profile__732560805006016523__profile.png'],
  ['Tester 743405383380500531', 'profile__743405383380500531__profile.png'],
  ['Tester 757267693136117820', 'profile__757267693136117820__profile.png'],
  ['Tester 770584603852275712', 'profile__770584603852275712__profile.png'],
  ['Founder', 'profile__founder__founder_profile.png'],
];

function escapeXml(value) {
  return value.replace(/[<>&'"]/g, (ch) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[ch]);
}

async function main() {
  const rows = Math.ceil(entries.length / COLS);
  const sheetW = COLS * TILE_W + (COLS + 1) * GAP;
  const tileH = LABEL_H + IMAGE_H;
  const sheetH = rows * tileH + (rows + 1) * GAP;
  const composite = [];

  for (let i = 0; i < entries.length; i++) {
    const [label, filename] = entries[i];
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const left = GAP + col * (TILE_W + GAP);
    const top = GAP + row * (tileH + GAP);
    const image = await sharp(path.join(DIR, filename))
      .resize(TILE_W, IMAGE_H, { fit: 'fill' })
      .png()
      .toBuffer();
    const svg = Buffer.from(
      `<svg width="${TILE_W}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="100%" height="100%" fill="#181A20"/>` +
      `<text x="18" y="29" fill="#F2F3F5" font-family="Arial, sans-serif" font-size="20" font-weight="700">` +
      `${escapeXml(label)}</text></svg>`
    );
    composite.push({ input: svg, left, top });
    composite.push({ input: image, left, top: top + LABEL_H });
  }

  await sharp({
    create: { width: sheetW, height: sheetH, channels: 4, background: '#0E1015' },
  }).composite(composite).png().toFile(OUT);
  console.log(OUT);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
