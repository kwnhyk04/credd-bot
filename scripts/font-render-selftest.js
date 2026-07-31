'use strict';

/**
 * FONT RENDER SELFTEST
 *
 * Guards the centralized font pipeline (src/utils/fontRegistry.js) against the two
 * failure modes that produced empty square boxes (tofu):
 *
 *   1. A renderer drawing with a family nobody registered, which only worked when
 *      some other module happened to be required first (bossSystem.js did exactly
 *      this) — so the same command rendered fine or as boxes depending on load order.
 *   2. `ctx.font` naming ONE family. DejaVu Sans has no CJK/Hangul/Thai/Devanagari
 *      coverage, so a display name carrying those codepoints drew boxes regardless of
 *      how healthy the rest of the pipeline was.
 *
 * Tofu is detected by INK, not by width: a missing glyph still advances the pen, so
 * measureText cannot tell a real glyph from a box. Each probe renders to a canvas and
 * counts lit pixels, then compares against a control.
 *
 * Run: node scripts/font-render-selftest.js
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const {
  PRIMARY_FAMILY, fontStack, familyList, fontSpec, missingGlyphs, unsupportedGlyphs,
  fontRegistryState,
} = require(path.join(ROOT, 'src', 'utils', 'fontRegistry'));

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) { console.log(`\n── ${title} ──`); }

/** Lit-pixel count for `text` drawn with `font`. 0 = nothing drawn at all. */
function inkOf(font, text, w = 420, h = 80) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 6, h / 2);
  const data = ctx.getImageData(0, 0, w, h).data;
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] > 40) lit += 1;
  return lit;
}

/**
 * A tofu box is a hollow rectangle: identical for EVERY unsupported codepoint. Two
 * different unsupported characters rendering the same ink is the signature; real
 * glyphs from a fallback font differ from each other.
 */
function looksLikeTofu(font, a, b) {
  return inkOf(font, a) === inkOf(font, b);
}

// ═══════════════════════════════════════════════════════════════════════════
section('1. Registry initialization');

const state = fontRegistryState();
check('registry completed initialization at require time', state.ready === true);
check('no font failed to register', state.errors.length === 0,
  state.errors.map((e) => `${e.file}: ${e.message}`).join('; '));
check('at least one font file was registered',
  state.sources.filter((s) => s.registered).length > 0, JSON.stringify(state.sources));
check('the primary family is bundled, not assumed from the host',
  state.sources.some((s) => s.family === PRIMARY_FAMILY && s.registered),
  JSON.stringify(state.sources));
check('the primary font cmap parsed (coverage is a fact, not a guess)',
  state.primaryCoverageSize > 1000, `codepoints=${state.primaryCoverageSize}`);

// ═══════════════════════════════════════════════════════════════════════════
section('2. Font stack shape');

const stack = fontStack();
check('the stack leads with the project font', stack.startsWith(`"${PRIMARY_FAMILY}"`), stack);
check('the stack ends with a generic family', stack.endsWith('sans-serif'), stack);
check('familyList() returns a quoted list callers must not re-quote',
  familyList(null) === stack && familyList(PRIMARY_FAMILY) === stack, familyList(null));
check('a skin-declared family is honoured and still gets the fallback chain',
  familyList('Custom Skin Font') === `"Custom Skin Font", ${stack}`, familyList('Custom Skin Font'));
check('fontSpec builds valid CSS shorthand',
  fontSpec(18, { weight: 'bold' }) === `bold 18px ${stack}`, fontSpec(18, { weight: 'bold' }));
check('fontSpec clamps a nonsense size instead of emitting NaN',
  /^\d+px /.test(fontSpec(0)) && !fontSpec(undefined).includes('NaN'), fontSpec(undefined));
check('every fallback family in the stack is a real non-empty family name',
  state.fallbackFamilies.every((f) => typeof f === 'string' && f.length > 0),
  state.fallbackFamilies.join(', '));

// ═══════════════════════════════════════════════════════════════════════════
section('3. Glyph coverage reporting');

check('ASCII needs no fallback', missingGlyphs('Hero Level 42 — ATK 1,234').length === 0);
check('Latin-1 / Greek / Cyrillic are covered by the primary font',
  missingGlyphs('Ñoño Ægir Ωμέγα Привет').length === 0,
  missingGlyphs('Ñoño Ægir Ωμέγα Привет').join(''));
check('CJK is correctly reported as outside the primary font',
  missingGlyphs('漢字').length === 2, missingGlyphs('漢字').join(''));
check('missingGlyphs deduplicates repeats', missingGlyphs('漢漢漢').length === 1);
check('whitespace never counts as a missing glyph', missingGlyphs('   \t\n  ').length === 0);
check('empty / null input is safe',
  missingGlyphs('').length === 0 && missingGlyphs(null).length === 0);
check('the configured fallback stack covers the CJK probe',
  state.fallbackFamilies.length === 0 || unsupportedGlyphs('漢字').length === 0,
  unsupportedGlyphs('漢字').join(''));
check('actual unsupported glyphs are detected against the missing-glyph sentinel',
  unsupportedGlyphs(String.fromCodePoint(0x10FFFF)).length === 1);

{
  const rendererFiles = [
    'renderBagItems.js',
    'renderPortraitCard.js',
    'renderProfile.js',
    'renderQuestRows.js',
    'renderStats.js',
    'renderSummon.js',
    'weaponResultRenderer.js',
  ];
  const requoted = rendererFiles.filter((file) =>
    fs.readFileSync(path.join(ROOT, 'src', 'engine', file), 'utf8')
      .includes('"${FONT_FAMILY}"'));
  check('renderers do not wrap the complete CSS fallback stack in another quote pair',
    requoted.length === 0, requoted.join(', '));
}

// ═══════════════════════════════════════════════════════════════════════════
section('4. Rendering — Unicode names do not become boxes');

{
  check('ASCII renders ink with the shared stack', inkOf(fontSpec(28), 'Hero') > 50);

  // Adding fallbacks must not disturb glyphs the primary font already owns.
  const bare = inkOf(`28px "${PRIMARY_FAMILY}"`, 'Ñoño Ægir');
  const stacked = inkOf(fontSpec(28), 'Ñoño Ægir');
  check('the fallback chain does not alter glyphs the primary font already has',
    bare === stacked, `bare=${bare} stacked=${stacked}`);

  const cjkStacked = inkOf(fontSpec(28), '漢字');
  const cjkBare = inkOf(`28px "${PRIMARY_FAMILY}"`, '漢字');
  if (state.fallbackFamilies.length > 0) {
    check('CJK renders real glyphs through the fallback chain, not boxes',
      cjkStacked !== cjkBare && cjkStacked > 0,
      `stacked=${cjkStacked} primaryOnly=${cjkBare} fallbacks=${state.fallbackFamilies.join(',')}`);
    check('two different CJK characters render differently (not identical boxes)',
      !looksLikeTofu(fontSpec(28), '漢', '語'));
  } else {
    // No Unicode font on this host. Not a code fault — but it documents the failure
    // and the container installs one (Dockerfile: fonts-noto-cjk / fonts-noto-core).
    console.log('  (no Unicode fallback on this host — skipping CJK ink assertions)');
    check('with no fallback the primary font does produce identical boxes (documents the bug)',
      looksLikeTofu(`28px "${PRIMARY_FAMILY}"`, '漢', '語'));
  }

  // The realistic Discord case: a mixed name must not lose its ASCII half.
  const mixed = inkOf(fontSpec(28), 'Player漢字Name');
  check('a mixed ASCII + CJK display name still renders its ASCII portion',
    mixed > inkOf(fontSpec(28), '漢字'), `mixed=${mixed}`);

  // The brief forbids replacing a valid username with blanks — the registry only
  // reports, it never rewrites.
  const original = 'Ω漢字Ünïcødé';
  const reported = missingGlyphs(original);
  check('the registry never rewrites text (missingGlyphs is read-only)',
    Array.isArray(reported) && original === 'Ω漢字Ünïcødé');
}

// ═══════════════════════════════════════════════════════════════════════════
section('5. Concurrency — no load-order or race dependency');

{
  // Registration is synchronous at require time, so concurrent renders cannot
  // interleave with it. Prove the same text renders byte-identically under
  // simultaneous load — which is exactly what "random square boxes" would violate.
  const font = fontSpec(24, { weight: 'bold' });
  const samples = ['Hero', 'Ñoño', 'Player漢字Name', '한글Test', 'Ωμέγα'];
  const baseline = samples.map((t) => inkOf(font, t));

  Promise.all(Array.from({ length: 24 }, async () => {
    await new Promise((r) => setImmediate(r));
    return samples.map((t) => inkOf(font, t));
  })).then((results) => {
    const drift = results.find((row) => row.some((ink, i) => ink !== baseline[i]));
    check('24 concurrent renders produce identical ink for every sample', !drift,
      drift ? JSON.stringify({ baseline, got: drift }) : '');
    check('no concurrent render produced a blank result',
      results.every((row) => row.every((ink) => ink > 0)));

    // Re-requiring the registry must be a no-op, not a re-registration.
    const before = fontRegistryState();
    require(path.join(ROOT, 'src', 'utils', 'fontRegistry')).initFonts();
    const after = fontRegistryState();
    check('initFonts() is idempotent (re-require does not double-register)',
      before.sources.length === after.sources.length && after.stack === before.stack,
      `${before.sources.length} -> ${after.sources.length}`);

    finish();
  }).catch((err) => {
    check('concurrency probe completed', false, err.message);
    finish();
  });
}

function finish() {
  console.log('\n══════════════════════════════════════════════════');
  console.log(`FONT RENDER SELFTEST: ${passed} passed, ${failures.length} failed`);
  if (state.fallbackFamilies.length === 0) {
    console.warn('NOTE: this host has no Unicode fallback family installed. Production '
      + 'installs fonts-noto-cjk / fonts-noto-core via the Dockerfile.');
  } else {
    console.log(`Fallback chain: ${state.fallbackFamilies.join(' → ')}`);
  }
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('All checks passed.');
}
