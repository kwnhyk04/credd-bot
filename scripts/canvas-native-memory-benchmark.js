'use strict';

process.env.RESOURCE_LOGS = 'false';

const { performance } = require('node:perf_hooks');
const imageRuntime = require('../src/utils/imageRuntime');
const { createCanvas } = require('@napi-rs/canvas');
const { encodeCanvas } = require('../src/utils/canvasEncode');

const iterations = Math.max(1, Math.min(500, Number(process.env.CANVAS_BENCH_ITERATIONS) || 100));

function memorySnapshot(label) {
  const memory = process.memoryUsage();
  return {
    label,
    rssMb: Math.round(memory.rss / 1024 / 1024),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    externalMb: Math.round(memory.external / 1024 / 1024),
    arrayBuffersMb: Math.round(memory.arrayBuffers / 1024 / 1024),
    canvas: imageRuntime.getCanvasRuntimeStats(),
  };
}

function renderOne(index) {
  const canvas = createCanvas(1536, 1024);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 1536, 1024);
  gradient.addColorStop(0, `hsl(${index % 360} 70% 30%)`);
  gradient.addColorStop(1, `hsl(${(index + 120) % 360} 70% 60%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1536, 1024);
  ctx.font = 'bold 72px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(`render ${index}`, 80, 140);
  encodeCanvas(canvas);
}

async function main() {
  const snapshots = [memorySnapshot('before')];
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) renderOne(index);
  snapshots.push(memorySnapshot('after-burst'));

  // No forced GC: the production debounce clears the process-wide Skia cache at quiescence.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  snapshots.push(memorySnapshot('after-quiescence'));
  const stats = imageRuntime.getCanvasRuntimeStats();
  if (stats.activeCanvases !== 0 || stats.nativeCacheClears < 1) {
    throw new Error(`canvas runtime did not quiesce: ${JSON.stringify(stats)}`);
  }

  console.log(JSON.stringify({
    iterations,
    durationMs: Math.round(performance.now() - started),
    snapshots,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
