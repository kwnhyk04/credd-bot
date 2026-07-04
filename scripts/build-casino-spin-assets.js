'use strict';

/**
 * build-casino-spin-assets.js — pre-render every DETERMINISTIC casino media
 * variant once, so production can reference them as public R2 URLs instead of
 * re-uploading the same bytes to Discord on every game (Railway bills that
 * upload as egress; R2 egress is free).
 *
 * Outputs to assets/generated/casino/ (upload this folder to the R2 bucket at
 * the same relative path, i.e. <ASSET_BASE_URL>/generated/casino/...):
 *   coin_spin_heads.gif / coin_spin_tails.gif   — padded flip GIFs (~1.2 MB each)
 *   die_1.gif .. die_6.gif                      — padded dice-roll GIFs
 *   slot_spin_<f0>_<f1>_<f2>.gif                — 125 composited reel strips
 *   coin_face_heads.png / coin_face_tails.png   — result face strip
 *   dice_faces_<d1>_<d2>.png                    — 36 result face strips
 *   slot_faces_<f0>_<f1>_<f2>.png               — 125 result face strips
 *
 * Rendering goes through the SAME imagePad/casinoCanvas code paths the bot
 * uses at runtime, so the pre-rendered files are pixel-identical to what the
 * attach-fallback would send. Re-run after changing any casino art, then
 * re-upload and bump ASSET_VERSION.
 */

require('dotenv').config();
// Force local asset reads: generation must not depend on (or bill) the bucket.
delete process.env.ASSET_BASE_URL;

const fs = require('fs');
const path = require('path');
const imagePad = require('../src/casino/imagePad');
const canvas = require('../src/casino/casinoCanvas');
const { SLOT_FACES, SLOT_FACE_INDEX } = require('../src/casino/payoutTables');
const { assetPath } = require('../src/utils/assets');

const OUT_DIR = path.join(process.cwd(), 'assets', 'generated', 'casino');

// Same source-path builders and spin dimensions as casinoRender.js.
const DIM = { coin: { W: 460, H: 132, contentH: 92 }, dice: { W: 200, H: 120, contentH: 84 } };
const coinGif = (r) => assetPath(`casino/coin/flip_${r}.gif`);
const coinPng = (r) => assetPath(`casino/coin/${r}.png`);
const diceGif = (n) => assetPath(`casino/dice/dice_roll_${n}.gif`);
const dicePng = (n) => assetPath(`casino/dice/face_${n}.png`);
const slotReelGif = (i, face) =>
  assetPath(`casino/slots/${['3s', '4s', '5s'][i]}/${['3s', '4s', '5s'][i]}_${face}_${SLOT_FACE_INDEX[face]}.gif`);
const slotFacePng = (face) => assetPath(`casino/slots/${face}_face.png`);

async function writeOut(name, bufferPromise) {
  const buffer = await bufferPromise;
  if (!buffer || buffer.length === 0) throw new Error(`empty buffer for ${name}`);
  await fs.promises.writeFile(path.join(OUT_DIR, name), buffer);
  return buffer.length;
}

(async () => {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  let total = 0;
  let count = 0;
  const add = async (name, promise) => {
    const bytes = await writeOut(name, promise);
    total += bytes;
    count += 1;
    console.log(`  ${name}  ${(bytes / 1024).toFixed(0)} KB`);
  };

  console.log('[coin] spin + face');
  for (const r of ['heads', 'tails']) {
    await add(`coin_spin_${r}.gif`, imagePad.padGif(coinGif(r), DIM.coin));
    await add(`coin_face_${r}.png`, canvas.strip([coinPng(r)], { tile: 78 }));
  }

  console.log('[dice] spin + faces');
  for (let n = 1; n <= 6; n++) {
    await add(`die_${n}.gif`, imagePad.padGif(diceGif(n), DIM.dice));
  }
  for (let d1 = 1; d1 <= 6; d1++) {
    for (let d2 = 1; d2 <= 6; d2++) {
      await add(`dice_faces_${d1}_${d2}.png`, canvas.strip([dicePng(d1), dicePng(d2)], { tile: 72 }));
    }
  }

  console.log('[slot] spin strips + faces (125 each)');
  for (const f0 of SLOT_FACES) {
    for (const f1 of SLOT_FACES) {
      for (const f2 of SLOT_FACES) {
        await add(
          `slot_spin_${f0}_${f1}_${f2}.gif`,
          imagePad.reelStripGif([slotReelGif(0, f0), slotReelGif(1, f1), slotReelGif(2, f2)])
        );
        await add(
          `slot_faces_${f0}_${f1}_${f2}.png`,
          canvas.strip([f0, f1, f2].map(slotFacePng), { tile: 84 })
        );
      }
    }
  }

  console.log('[daily] attendance banner');
  const dailyDir = path.join(process.cwd(), 'assets', 'generated', 'daily');
  await fs.promises.mkdir(dailyDir, { recursive: true });
  const bannerBuf = await require('../src/commands/economy/daily').banner();
  if (bannerBuf) {
    await fs.promises.writeFile(path.join(dailyDir, 'attendance_banner.png'), bannerBuf);
    total += bannerBuf.length;
    count += 1;
    console.log(`  attendance_banner.png  ${(bannerBuf.length / 1024).toFixed(0)} KB`);
  }

  console.log(`\nDone: ${count} files, ${(total / 1024 / 1024).toFixed(1)} MB in assets/generated/`);
  console.log('Upload assets/generated/ to the R2 bucket (same relative path), then the bot');
  console.log('serves these via URL automatically — no restart or env change needed.');
  process.exit(0);
})().catch((err) => {
  console.error('[build-casino-spin-assets] failed:', err);
  process.exit(1);
});
