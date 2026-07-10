'use strict';

/**
 * Ascension Patch §5.1 — one-off asset recompression to WebP.
 *
 *   node scripts/recompress-assets.js [--quality 72] [--dirs a,b,c] [--out assets/_recompressed]
 *
 * - Walks the raid battle skins, battle-result skins, class battle bases,
 *   supporter badges, and avatar sets (DEFAULT_DIRS below, relative to assets/).
 *   Missing folders are skipped with a note (some sets are R2-only).
 * - Re-encodes every .png/.jpg/.jpeg/.webp via sharp to WebP at --quality
 *   (default 72). NO RESIZING — dimensions stay identical.
 * - KEEPS THE ORIGINAL FILENAME/extension: catalog rows and layout JSONs
 *   reference e.g. `.png` keys, and every consumer (canvas loadImage, sharp)
 *   sniffs magic bytes, not extensions. The owner uploads each staging file
 *   over the SAME R2 key it mirrors.
 * - Skips a file when the WebP re-encode is NOT smaller (already optimal).
 * - Writes results to a staging mirror (never touches originals) plus a
 *   per-file before/after report (console + <out>/recompress-report.txt).
 *   The owner reviews visually, uploads to R2, then bumps ASSET_VERSION
 *   (see docs/ASSET_VERSION_BUMP.md).
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');

// §5.1 target sets, relative to assets/ (= relative to the R2 bucket root).
const DEFAULT_DIRS = [
  'skins/supporters',        // battle + result skins, bases, supporter badges
  'skins/avatars',           // founder avatar set (if mirrored locally)
  'skins/testers',           // beta tester avatar set
  'classes/battle_base',     // §2.1 class battle bases
];

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function parseArgs(argv) {
  const args = { quality: 72, dirs: DEFAULT_DIRS, out: path.join(ASSETS, '_recompressed') };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quality') args.quality = Number(argv[++i]);
    else if (a === '--dirs') args.dirs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') args.out = path.resolve(ROOT, argv[++i]);
    else if (a === '--help') {
      console.log('Usage: node scripts/recompress-assets.js [--quality 72] [--dirs a,b,c] [--out assets/_recompressed]');
      process.exit(0);
    }
  }
  if (!Number.isFinite(args.quality) || args.quality < 1 || args.quality > 100) {
    console.error(`Invalid --quality ${args.quality} (1-100).`);
    process.exit(1);
  }
  return args;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function fmt(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

async function main() {
  const { quality, dirs, out } = parseArgs(process.argv);
  console.log(`Recompress → WebP q${quality} (no resize). Staging: ${path.relative(ROOT, out)}\n`);

  const rows = [];
  let before = 0;
  let after = 0;
  let skippedLarger = 0;

  for (const rel of dirs) {
    const dir = path.join(ASSETS, rel);
    if (!fs.existsSync(dir)) {
      console.log(`(skip) assets/${rel} — not present locally (R2-only set?)`);
      continue;
    }
    for (const file of walk(dir)) {
      const ext = path.extname(file).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      const relPath = path.relative(ASSETS, file);
      const src = fs.readFileSync(file);

      let webp;
      try {
        // Quality-only re-encode. NO resize — dimensions must stay identical.
        webp = await sharp(src).webp({ quality }).toBuffer();
      } catch (err) {
        console.warn(`(error) ${relPath}: ${err.message}`);
        continue;
      }

      before += src.length;
      if (webp.length >= src.length) {
        after += src.length;
        skippedLarger += 1;
        rows.push({ relPath, from: src.length, to: src.length, note: 'kept (webp not smaller)' });
        continue;
      }
      after += webp.length;

      const dest = path.join(out, relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, webp);
      rows.push({ relPath, from: src.length, to: webp.length, note: '' });
    }
  }

  if (rows.length === 0) {
    console.log('No images found under the target folders.');
    return;
  }

  const lines = rows.map((r) => {
    const pct = ((1 - r.to / r.from) * 100).toFixed(1);
    return `${r.relPath}  ${fmt(r.from)} → ${fmt(r.to)}  (−${pct}%)${r.note ? `  [${r.note}]` : ''}`;
  });
  const totalPct = before > 0 ? ((1 - after / before) * 100).toFixed(1) : '0.0';
  const summary = [
    '', '─'.repeat(60),
    `Files: ${rows.length}  (${skippedLarger} kept as-is — WebP not smaller)`,
    `Total: ${fmt(before)} → ${fmt(after)}  (−${totalPct}%)`,
    `Quality: ${quality} · No resizing performed.`,
    `Staging output: ${path.relative(ROOT, out)}`,
    'Next: visually review staging files, upload to R2 over the SAME keys,',
    'then bump ASSET_VERSION (docs/ASSET_VERSION_BUMP.md).',
  ];

  const report = lines.concat(summary).join('\n');
  console.log(report);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'recompress-report.txt'), `${report}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
