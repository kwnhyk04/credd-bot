'use strict';

/**
 * C5 — DEPENDENCY-GRAPH GATE (Phase 0, refactor plan).
 *
 * Builds the static require() graph over index.js + src/ and fails on any
 * cycle. The repo is acyclic today; every refactor step must keep it that way.
 * Self-requires inside comments are ignored (only real require() calls parse).
 *
 * Usage:
 *   node scripts/dep-graph-check.js            # exit 0 when acyclic, 1 on cycles
 *   node scripts/dep-graph-check.js --stats    # also print fan-in/fan-out tables
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function collectFiles() {
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js')) files.push(p);
    }
  })(path.join(ROOT, 'src'));
  files.push(path.join(ROOT, 'index.js'));
  return files;
}

// Strip comments so a require() mentioned in a doc block is not counted as an edge.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function buildGraph(files) {
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
  const deps = {};
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let m; const list = [];
    while ((m = re.exec(src))) {
      let r = path.resolve(path.dirname(f), m[1]);
      if (fs.existsSync(`${r}.js`)) r += '.js';
      else if (fs.existsSync(path.join(r, 'index.js'))) r = path.join(r, 'index.js');
      list.push(rel(r));
    }
    deps[rel(f)] = list;
  }
  return deps;
}

function findCycles(deps) {
  const color = {}; const stack = []; const cycles = []; const seen = new Set();
  function dfs(n) {
    color[n] = 1; stack.push(n);
    for (const d of deps[n] || []) {
      if (color[d] === 1) {
        const cyc = stack.slice(stack.indexOf(d)).concat(d);
        const key = cyc.slice().sort().join('|');
        if (!seen.has(key)) { seen.add(key); cycles.push(cyc); }
      } else if (!color[d]) dfs(d);
    }
    stack.pop(); color[n] = 2;
  }
  for (const f of Object.keys(deps)) if (!color[f]) dfs(f);
  return cycles;
}

function main() {
  const deps = buildGraph(collectFiles());
  const cycles = findCycles(deps);
  const fileCount = Object.keys(deps).length;
  if (process.argv.includes('--stats')) {
    const fanIn = {};
    for (const ds of Object.values(deps)) for (const d of ds) fanIn[d] = (fanIn[d] || 0) + 1;
    console.log('Top fan-in:');
    Object.entries(fanIn).sort((a, b) => b[1] - a[1]).slice(0, 15)
      .forEach(([f, n]) => console.log(`  ${String(n).padStart(3)} ${f}`));
    console.log('Top fan-out:');
    Object.entries(deps).map(([f, ds]) => [f, ds.length]).sort((a, b) => b[1] - a[1]).slice(0, 15)
      .forEach(([f, n]) => console.log(`  ${String(n).padStart(3)} ${f}`));
  }
  if (cycles.length > 0) {
    console.error(`[C5] FAIL: ${cycles.length} require cycle(s) across ${fileCount} files:`);
    for (const c of cycles) console.error(`  - ${c.join(' -> ')}`);
    process.exit(1);
  }
  console.log(`[C5] OK: require graph over ${fileCount} files is acyclic.`);
}

main();
