'use strict';

/**
 * analyze-resource-logs — digest Railway (or local) log text containing
 * [resource] snapshots and report which memory term dominates RSS.
 *
 * Usage:
 *   node scripts/analyze-resource-logs.js <logfile>
 *   railway logs | node scripts/analyze-resource-logs.js
 *
 * Read-only: parses text, prints a table and a trend verdict. It never claims
 * a root cause — it classifies which follow-up experiment's evidence threshold
 * (documented in docs/production-memory-followup-2026-07-17.md) is met.
 */

const fs = require('fs');

function readInput() {
  const file = process.argv[2];
  if (file) return fs.readFileSync(file, 'utf8');
  try {
    return fs.readFileSync(0, 'utf8'); // stdin
  } catch {
    console.error('Usage: node scripts/analyze-resource-logs.js <logfile>  (or pipe logs via stdin)');
    process.exit(1);
  }
}

function parseSnapshots(text) {
  const snapshots = [];
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf('[resource]');
    if (idx === -1) continue;
    const detailsIdx = line.indexOf('details=', idx);
    if (detailsIdx === -1) continue;
    const jsonText = line.slice(detailsIdx + 'details='.length).trim();
    let details;
    try {
      details = JSON.parse(jsonText);
    } catch {
      continue; // truncated or interleaved line
    }
    const mem = details.memory || {};
    if (!Number.isFinite(Number(mem.rss))) continue;
    const cacheEstimates = details.cacheEstimates || {};
    const cacheBytes = Object.values(cacheEstimates)
      .reduce((sum, c) => sum + (Number(c.estimatedBytes) || 0), 0);
    snapshots.push({
      rss: Number(mem.rss) || 0,
      heapUsed: Number(mem.heapUsed) || 0,
      heapTotal: Number(mem.heapTotal) || 0,
      heapLimit: Number(mem.heapLimit) || 0,
      external: Number(mem.external) || 0,
      arrayBuffers: Number(mem.arrayBuffers) || 0,
      nativeGap: Number(mem.nativeGap) || 0,
      cacheMb: Math.round(cacheBytes / 1024 / 1024),
      discordMb: Math.round((Number(details.discord?.estimatedHeuristicBytes) || 0) / 1024 / 1024),
    });
  }
  return snapshots;
}

function pad(value, width) {
  return String(value).padStart(width);
}

function trend(values) {
  if (values.length < 3) return 'insufficient-data';
  const first = values.slice(0, Math.ceil(values.length / 3));
  const last = values.slice(-Math.ceil(values.length / 3));
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const firstAvg = avg(first);
  const lastAvg = avg(last);
  const rises = values.slice(1).filter((v, i) => v > values[i]).length;
  const monotonicRatio = rises / (values.length - 1);
  if (lastAvg > firstAvg * 1.15 && monotonicRatio > 0.6) return 'growing';
  if (Math.abs(lastAvg - firstAvg) <= Math.max(20, firstAvg * 0.1)) return 'plateau';
  if (lastAvg < firstAvg * 0.9) return 'declining';
  return 'fluctuating';
}

function main() {
  const snapshots = parseSnapshots(readInput());
  if (snapshots.length === 0) {
    console.error('No parseable [resource] details= snapshots found in input.');
    process.exit(1);
  }

  console.log(`Parsed ${snapshots.length} [resource] snapshot(s). All values MB.\n`);
  console.log(['#', 'rss', 'heapUsed', 'heapTotal', 'heapLimit', 'external', 'arrBuf', 'nativeGap', 'caches', 'discord']
    .map((h, i) => pad(h, i === 0 ? 4 : 9)).join(' '));
  snapshots.forEach((s, i) => {
    console.log([
      pad(i + 1, 4), pad(s.rss, 9), pad(s.heapUsed, 9), pad(s.heapTotal, 9),
      pad(s.heapLimit, 9), pad(s.external, 9), pad(s.arrayBuffers, 9),
      pad(s.nativeGap, 9), pad(s.cacheMb, 9), pad(s.discordMb, 9),
    ].join(' '));
  });

  const last = snapshots[snapshots.length - 1];
  const terms = {
    heapTotal: last.heapTotal,
    external: last.external,
    nativeGap: last.nativeGap,
  };
  const dominant = Object.entries(terms).sort((a, b) => b[1] - a[1])[0];
  const dominantShare = last.rss ? dominant[1] / last.rss : 0;

  console.log('\n--- Trend (first third vs last third) ---');
  for (const key of ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers', 'nativeGap']) {
    console.log(`${key.padEnd(13)} ${trend(snapshots.map((s) => s[key]))}`);
  }

  console.log('\n--- Verdict (evidence classification, not a root-cause claim) ---');
  console.log(`Latest RSS ${last.rss} MB; dominant non-heapUsed term: ${dominant[0]} = ${dominant[1]} MB (${Math.round(dominantShare * 100)}% of RSS).`);

  const nativeTrend = trend(snapshots.map((s) => s.nativeGap));
  if (dominant[0] === 'nativeGap' && dominantShare > 0.5) {
    if (nativeTrend === 'plateau') {
      console.log('Threshold check: nativeGap dominates and plateaus -> MALLOC_ARENA_MAX=2 experiment threshold MET (verify canvas/cache counters near baseline first).');
    } else if (nativeTrend === 'growing') {
      console.log('Threshold check: nativeGap dominates and GROWS -> treat as potential code-level native leak; correlate with [renderer-memory] bursts. Do NOT apply allocator env experiments yet.');
    } else {
      console.log(`Threshold check: nativeGap dominates but trend is ${nativeTrend} -> collect more snapshots before any experiment.`);
    }
  } else if (dominant[0] === 'heapTotal' && last.heapTotal > 250 && last.heapUsed < 120) {
    console.log(`Threshold check: heapTotal ${last.heapTotal} MB >> heapUsed ${last.heapUsed} MB (heapLimit ${last.heapLimit} MB) -> NODE_OPTIONS=--max-old-space-size=512 experiment threshold MET.`);
  } else if (dominant[0] === 'external' && last.external > 150) {
    console.log('Threshold check: external dominates -> inspect arrayBuffers + cache snapshots for Buffer retention (code-level path, not env experiment).');
  } else {
    console.log('Threshold check: no documented experiment threshold met by this sample. Collect >=24h of snapshots.');
  }
}

main();
