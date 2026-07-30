'use strict';

/**
 * fontRegistry.js — the ONE font initialization flow for every canvas renderer.
 *
 * WHY THIS EXISTS
 * Font setup used to be copy-pasted into ~13 renderer modules, each registering
 * `DejaVuSans.ttf` / `DejaVuSans-Bold.ttf` at require time and each swallowing the
 * error. Two consequences, both user-visible as empty square boxes (tofu):
 *
 *   1. `bossSystem.js` drew with `'DejaVu Sans'` but never registered it. Whether the
 *      family existed depended purely on whether some OTHER renderer had been required
 *      first — so identical commands rendered correctly or as boxes depending on module
 *      load order. That is the "random, not limited to new users" symptom.
 *   2. `ctx.font = '20px "DejaVu Sans"'` names ONE family. DejaVu Sans has no CJK,
 *      Hangul, Devanagari, Thai or emoji coverage, so any username / title / deity name
 *      carrying those codepoints rendered as boxes no matter how healthy the pipeline was.
 *
 * WHAT THIS DOES
 *   - Registers every font file in `assets/fonts/` exactly once, synchronously, at
 *     require time. Requiring this module IS the initialization; there is no async
 *     phase a render can outrun and no per-worker state to lose.
 *   - Publishes FONT_STACK: the primary family followed by every Unicode-capable
 *     fallback family that is ACTUALLY registered in this process (bundled first, then
 *     system families discovered through GlobalFonts), ending in `sans-serif`.
 *     @napi-rs/canvas resolves the CSS family list per GLYPH, so a Latin name in DejaVu
 *     and a CJK title in the same string both render — verified by pixel probe in
 *     scripts/font-render-selftest.js.
 *   - Never rewrites or strips text. Callers keep the original string; the stack picks
 *     the font per glyph.
 *   - Reports codepoints the bundled primary font cannot draw (parsed from its real
 *     OpenType cmap) so a render leaning on the fallback chain is observable.
 *
 * ADDING COVERAGE: drop the .ttf/.otf into `assets/fonts/` (or install the system
 * package, e.g. `fonts-noto-cjk`). No code change — both paths are picked up here.
 */

const fs = require('fs');
const path = require('path');
const { GlobalFonts } = require('@napi-rs/canvas');
const { envBool, envPositiveInt } = require('./runtimeLogs');

const ROOT = path.join(__dirname, '..', '..');
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');

/** The project's main family. Bundled, so it is always present. */
const PRIMARY_FAMILY = 'DejaVu Sans';

/**
 * Bundled files that must land in one family so `bold …` resolves to the bold face
 * instead of synthesizing. Anything else in assets/fonts is registered under the
 * family name baked into the file itself.
 */
const BUNDLED_FAMILY_OVERRIDES = new Map([
  ['dejavusans.ttf', PRIMARY_FAMILY],
  ['dejavusans-bold.ttf', PRIMARY_FAMILY],
  ['dejavusans-oblique.ttf', PRIMARY_FAMILY],
  ['dejavusans-boldoblique.ttf', PRIMARY_FAMILY],
]);

/**
 * Fallback families in preference order. A family joins the stack only if this process
 * actually has it, so the emitted CSS never names a font that does not exist. Ordered
 * widest-coverage first; emoji last, because colour-emoji faces carry no text glyphs
 * and must not shadow a real text font.
 */
const FALLBACK_PREFERENCE = [
  // CJK — the single biggest tofu source for Discord display names.
  'Noto Sans CJK SC', 'Noto Sans CJK JP', 'Noto Sans CJK KR', 'Noto Sans CJK TC',
  'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR',
  'Source Han Sans', 'WenQuanYi Zen Hei',
  'Microsoft YaHei', 'Malgun Gothic', 'Meiryo', 'Yu Gothic', 'SimSun', 'MS Gothic',
  // Broad pan-Unicode text faces.
  'Noto Sans', 'Noto Sans Symbols 2', 'Noto Sans Symbols2',
  'Arial Unicode MS', 'Liberation Sans', 'FreeSans', 'Segoe UI', 'Symbola',
  // Script-specific gap fillers shipped by fonts-noto-core.
  'Noto Sans Arabic', 'Noto Sans Hebrew', 'Noto Sans Thai', 'Noto Sans Devanagari',
  'Noto Sans Georgian', 'Noto Sans Armenian', 'Noto Sans Bengali', 'Noto Sans Tamil',
  // Emoji.
  'Noto Color Emoji', 'Noto Emoji', 'Segoe UI Emoji', 'Apple Color Emoji', 'Twemoji',
];

const FONT_FILE_RE = /\.(ttf|otf|ttc)$/i;

// ── OpenType cmap coverage ───────────────────────────────────────────────────
// Parsed straight from the file so "can the primary font draw this?" is a fact rather
// than a guess. Only formats 4 (BMP) and 12 (full range) are read — between them they
// cover every modern Unicode cmap subtable; skipping the others can only UNDER-report
// coverage (a spurious "missing glyph" note), never claim coverage we lack.

function readCmapCoverage(buf) {
  const covered = new Set();
  if (buf.length < 16) return covered;

  let offset = 0;
  if (buf.readUInt32BE(0) === 0x74746366) offset = buf.readUInt32BE(12); // 'ttcf' → first face
  if (offset + 12 > buf.length) return covered;

  const numTables = buf.readUInt16BE(offset + 4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 12 + i * 16;
    if (rec + 16 > buf.length) break;
    if (buf.toString('ascii', rec, rec + 4) === 'cmap') {
      cmapOffset = buf.readUInt32BE(rec + 8);
      break;
    }
  }
  if (cmapOffset < 0 || cmapOffset + 4 > buf.length) return covered;

  const subtableCount = buf.readUInt16BE(cmapOffset + 2);
  const subtables = [];
  for (let i = 0; i < subtableCount; i++) {
    const rec = cmapOffset + 4 + i * 8;
    if (rec + 8 > buf.length) break;
    subtables.push(cmapOffset + buf.readUInt32BE(rec + 4));
  }

  for (const sub of new Set(subtables)) {
    if (sub + 4 > buf.length) continue;
    const format = buf.readUInt16BE(sub);
    if (format === 4) readCmapFormat4(buf, sub, covered);
    else if (format === 12) readCmapFormat12(buf, sub, covered);
  }
  return covered;
}

function readCmapFormat4(buf, sub, covered) {
  const segCountX2 = buf.readUInt16BE(sub + 6);
  const segCount = segCountX2 / 2;
  const endBase = sub + 14;
  const startBase = endBase + segCountX2 + 2;
  const deltaBase = startBase + segCountX2;
  const rangeBase = deltaBase + segCountX2;
  if (rangeBase + segCountX2 > buf.length) return;

  for (let s = 0; s < segCount; s++) {
    const end = buf.readUInt16BE(endBase + s * 2);
    const start = buf.readUInt16BE(startBase + s * 2);
    if (start > end || start === 0xFFFF) continue;
    const rangeOffset = buf.readUInt16BE(rangeBase + s * 2);
    const delta = buf.readInt16BE(deltaBase + s * 2);
    for (let cp = start; cp <= end; cp++) {
      let glyph;
      if (rangeOffset === 0) {
        glyph = (cp + delta) & 0xFFFF;
      } else {
        const at = rangeBase + s * 2 + rangeOffset + (cp - start) * 2;
        if (at + 2 > buf.length) continue;
        glyph = buf.readUInt16BE(at);
        if (glyph !== 0) glyph = (glyph + delta) & 0xFFFF;
      }
      if (glyph !== 0) covered.add(cp);
    }
  }
}

function readCmapFormat12(buf, sub, covered) {
  const groupCount = buf.readUInt32BE(sub + 12);
  for (let g = 0; g < groupCount; g++) {
    const rec = sub + 16 + g * 12;
    if (rec + 12 > buf.length) break;
    const start = buf.readUInt32BE(rec);
    const end = buf.readUInt32BE(rec + 4);
    // Guard against a pathological range blowing up memory; real fonts stay small.
    if (end < start || end - start > 0x20000) continue;
    for (let cp = start; cp <= end; cp++) covered.add(cp);
  }
}

// ── Registration (runs exactly once, at require time) ────────────────────────

const state = {
  ready: false,
  primaryFamily: PRIMARY_FAMILY,
  fallbackFamilies: [],
  stack: `"${PRIMARY_FAMILY}", sans-serif`,
  sources: [],       // [{ file, family, registered }]
  errors: [],        // [{ file, message }]
  primaryCoverage: new Set(),
  fontDir: FONT_DIR,
};

function listFontFiles() {
  try {
    return fs.readdirSync(FONT_DIR).filter((f) => FONT_FILE_RE.test(f)).sort();
  } catch (err) {
    state.errors.push({ file: FONT_DIR, message: `font directory unreadable: ${err.message}` });
    return [];
  }
}

function registerBundledFonts() {
  for (const file of listFontFiles()) {
    const full = path.join(FONT_DIR, file);
    const alias = BUNDLED_FAMILY_OVERRIDES.get(file.toLowerCase()) || null;
    try {
      // No alias → @napi-rs/canvas keeps the family name baked into the file, which is
      // what a dropped-in Noto build wants. Aliased files are forced into one family so
      // regular + bold resolve as weights of the SAME family.
      const ok = alias
        ? GlobalFonts.registerFromPath(full, alias)
        : GlobalFonts.registerFromPath(full);
      state.sources.push({ file, family: alias, registered: Boolean(ok) });
      if (!ok) state.errors.push({ file, message: 'registerFromPath returned false' });
    } catch (err) {
      state.sources.push({ file, family: alias, registered: false });
      state.errors.push({ file, message: err.message });
    }
  }
}

function availableFamilies() {
  try {
    return new Set((GlobalFonts.families || []).map((f) => f.family));
  } catch {
    return new Set();
  }
}

function buildStack() {
  const available = availableFamilies();
  const ordered = [];
  for (const family of FALLBACK_PREFERENCE) {
    if (available.has(family) && !ordered.includes(family)) ordered.push(family);
  }
  state.fallbackFamilies = ordered;
  state.stack = `${[PRIMARY_FAMILY, ...ordered].map((f) => `"${f}"`).join(', ')}, sans-serif`;
}

function loadPrimaryCoverage() {
  for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
    try {
      const buf = fs.readFileSync(path.join(FONT_DIR, file));
      for (const cp of readCmapCoverage(buf)) state.primaryCoverage.add(cp);
    } catch { /* absent face — coverage from the remaining file still applies */ }
  }
}

function initFonts() {
  if (state.ready) return state;
  registerBundledFonts();
  buildStack();
  loadPrimaryCoverage();
  state.ready = true;

  for (const e of state.errors) console.error(`[fontRegistry] ${e.file}: ${e.message}`);
  if (state.fallbackFamilies.length === 0) {
    console.warn(
      '[fontRegistry] no Unicode fallback family found — text outside DejaVu Sans coverage '
      + 'will render as boxes. Install fonts-noto-cjk / fonts-noto-core, or drop a .ttf into '
      + `${FONT_DIR}. stack=${state.stack}`
    );
  } else if (envBool('FONT_REGISTRY_LOG', false)) {
    console.log(`[fontRegistry] ready · stack=${state.stack} · files=${state.sources.length}`);
  }
  return state;
}

initFonts();

// ── Public API ───────────────────────────────────────────────────────────────

/** The full CSS family list. Renderers should use this, never a bare family name. */
function fontStack() {
  return state.stack;
}

/**
 * The CSS family list with `preferred` (a skin/layout-declared family) in front.
 * Always returns a QUOTED list, so callers must NOT wrap the result in quotes.
 */
function familyList(preferred = null) {
  return preferred && preferred !== PRIMARY_FAMILY
    ? `"${preferred}", ${state.stack}`
    : state.stack;
}

/**
 * CSS font shorthand with the fallback chain applied.
 * `family` overrides only the FIRST family; the fallbacks are always appended, so a
 * skin naming its own font still degrades gracefully instead of drawing boxes.
 */
function fontSpec(size, { weight = 'normal', italic = false, family = null } = {}) {
  const px = Math.max(1, Number(size) || 16);
  return `${italic ? 'italic ' : ''}${weight === 'bold' ? 'bold ' : ''}`
    + `${px}px ${familyList(family)}`;
}

/** Codepoints in `text` the bundled primary font cannot draw (deduped, order-preserving). */
function missingGlyphs(text) {
  const out = [];
  if (!text || state.primaryCoverage.size === 0) return out;
  const seen = new Set();
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    // Whitespace and control characters carry no visible-glyph obligation.
    if (cp < 0x21) continue;
    if (state.primaryCoverage.has(cp) || seen.has(cp)) continue;
    seen.add(cp);
    out.push(ch);
  }
  return out;
}

const glyphWarnThrottleMs = () =>
  envPositiveInt('FONT_GLYPH_WARN_THROTTLE_MS', 60_000, { max: 3_600_000 });
const lastGlyphWarn = new Map(); // renderer -> timestamp

/**
 * Diagnostic for a render whose text needs the fallback chain. Reports exactly what the
 * brief asks for — affected text, selected family, renderer name, init state, asset path
 * — and nothing the bot does not already display publicly. Throttled per renderer so a
 * busy guild cannot flood the log.
 *
 * Returns the missing characters so callers/tests can assert on them.
 */
function reportGlyphCoverage(renderer, text, { family = null } = {}) {
  const missing = missingGlyphs(text);
  if (missing.length === 0) return missing;
  const now = Date.now();
  if (now - (lastGlyphWarn.get(renderer) || 0) < glyphWarnThrottleMs()) return missing;
  lastGlyphWarn.set(renderer, now);
  if (lastGlyphWarn.size > 64) lastGlyphWarn.delete(lastGlyphWarn.keys().next().value);

  const codepoints = missing
    .map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(',');
  const emit = state.fallbackFamilies.length ? console.warn : console.error;
  emit(
    `[fontRegistry] glyphs outside "${PRIMARY_FAMILY}" · renderer=${renderer}`
    + ` · text=${JSON.stringify(String(text).slice(0, 64))}`
    + ` · codepoints=${codepoints}`
    + ` · family=${family || PRIMARY_FAMILY}`
    + ` · stack=${state.stack}`
    + ` · ready=${state.ready}`
    + ` · registered=${state.sources.filter((s) => s.registered).length}/${state.sources.length}`
    + ` · fallbacks=${state.fallbackFamilies.length}`
    + ` · assetPath=${FONT_DIR}`
    + (state.fallbackFamilies.length ? '' : ' · NO FALLBACK — these will render as boxes')
  );
  return missing;
}

/** Snapshot for selftests / health checks. */
function fontRegistryState() {
  return {
    ready: state.ready,
    primaryFamily: state.primaryFamily,
    fontDir: state.fontDir,
    stack: state.stack,
    fallbackFamilies: [...state.fallbackFamilies],
    sources: state.sources.map((s) => ({ ...s })),
    errors: state.errors.map((e) => ({ ...e })),
    primaryCoverageSize: state.primaryCoverage.size,
  };
}

module.exports = {
  PRIMARY_FAMILY,
  FONT_FAMILY: PRIMARY_FAMILY,   // drop-in for the old per-renderer constant
  initFonts,
  fontStack,
  familyList,
  fontSpec,
  missingGlyphs,
  reportGlyphCoverage,
  fontRegistryState,
};
