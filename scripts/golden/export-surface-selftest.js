'use strict';

/**
 * C3 + C4 — EXPORT-SURFACE AND SLASH-DEFINITION SNAPSHOTS (Phase 0, refactor plan).
 *
 * C3: for each module slated to move during the refactor, snapshot its export
 * names and types ({ name: typeof }). A facade that drops or retypes an export
 * fails here immediately.
 *
 * C4: serialize every slash-command definition (name, canonical, builder JSON)
 * — Discord-visible registration data must be byte-identical after any routing
 * refactor.
 *
 * Baseline: scripts/golden/export-surfaces.json
 *
 * Usage:
 *   node scripts/golden/export-surface-selftest.js           # verify
 *   node scripts/golden/export-surface-selftest.js --write   # (re)write baseline
 */

process.env.RESOURCE_LOGS = 'false';
process.env.PERFORMANCE_LOGS = 'false';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BASELINE_PATH = path.join(__dirname, 'export-surfaces.json');

const MODULES = [
  'src/engine/bossSystem.js',
  'src/engine/battleEngine.js',
  'src/engine/battleRender.js',
  'src/engine/statsLayoutRenderer.js',
  'src/engine/profileLayoutRenderer.js',
  'src/engine/battleLayoutRenderer.js',
  'src/engine/resultLayoutRenderer.js',
  'src/handlers/commandHandler.js',
];

function surfaceOf(mod) {
  const out = {};
  for (const key of Object.keys(mod).sort()) out[key] = typeof mod[key];
  return out;
}

function snapshot() {
  const snap = { modules: {}, slash: [] };
  for (const rel of MODULES) {
    snap.modules[rel] = surfaceOf(require(path.join(ROOT, rel)));
  }
  // C3 extra: the two command tables routing depends on.
  const { IMPLEMENTED, COMMAND_MAP } = require(path.join(ROOT, 'src/handlers/commandHandler.js'));
  snap.commandKeys = Object.keys(IMPLEMENTED).sort();
  snap.commandMapKeys = Object.keys(COMMAND_MAP).sort();
  // C4: slash definitions, fully serialized.
  const { definitions } = require(path.join(ROOT, 'src/commands/slashDefinitions.js'));
  snap.slash = definitions.map((d) => ({
    name: d.name,
    canonical: d.canonical,
    builder: d.builder.toJSON(),
    hasAssemble: typeof d.assemble === 'function',
  }));
  return snap;
}

function main() {
  const write = process.argv.includes('--write');
  const actual = snapshot();
  const actualStr = `${JSON.stringify(actual, null, 2)}\n`;
  if (write) {
    fs.writeFileSync(BASELINE_PATH, actualStr);
    console.log(`[C3/C4] baseline written: ${Object.keys(actual.modules).length} module surfaces, `
      + `${actual.commandKeys.length} commands, ${actual.slash.length} slash defs -> ${path.relative(ROOT, BASELINE_PATH)}`);
    return;
  }
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error('[C3/C4] FAIL: baseline missing. Run with --write first (on known-good code only).');
    process.exit(1);
  }
  const baselineStr = fs.readFileSync(BASELINE_PATH, 'utf8');
  if (baselineStr !== actualStr) {
    // Deep-equal check with a readable first-difference report.
    const baseline = JSON.parse(baselineStr);
    const diffs = [];
    for (const rel of Object.keys(baseline.modules)) {
      const b = baseline.modules[rel] || {};
      const a = actual.modules[rel] || {};
      for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
        if (b[k] !== a[k]) diffs.push(`${rel}: export '${k}' ${b[k] || 'missing'} -> ${a[k] || 'missing'}`);
      }
    }
    if (JSON.stringify(baseline.commandKeys) !== JSON.stringify(actual.commandKeys)) diffs.push('IMPLEMENTED keys changed');
    if (JSON.stringify(baseline.commandMapKeys) !== JSON.stringify(actual.commandMapKeys)) diffs.push('COMMAND_MAP keys changed');
    if (JSON.stringify(baseline.slash) !== JSON.stringify(actual.slash)) diffs.push('slash definitions changed');
    console.error(`[C3/C4] FAIL: snapshot differs from baseline (${diffs.length} area(s)):`);
    for (const d of diffs.slice(0, 30)) console.error(`  - ${d}`);
    process.exit(1);
  }
  console.log(`[C3/C4] OK: ${Object.keys(actual.modules).length} module surfaces, `
    + `${actual.commandKeys.length} commands, ${actual.slash.length} slash defs match baseline.`);
}

main();
