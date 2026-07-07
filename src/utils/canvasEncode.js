'use strict';

const { envBool, performanceLog } = require('./runtimeLogs');

function fastOpaqueEncodeEnabled() {
  return envBool('IMAGE_FAST_OPAQUE_ENCODE', false);
}

function fillOpaqueBackground(canvas, background) {
  const ctx = canvas.getContext('2d');
  const previous = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = previous;
}

function encodeOpaqueCanvas(canvas, logContext = {}, { background = '#1f2125' } = {}) {
  if (fastOpaqueEncodeEnabled()) {
    try {
      const started = Date.now();
      fillOpaqueBackground(canvas, background);
      const buffer = canvas.toBuffer('image/jpeg');
      performanceLog('canvas encoded', {
        ...logContext,
        format: 'jpeg',
        bytes: buffer.length,
        durationMs: Date.now() - started,
      });
      return buffer;
    } catch (err) {
      performanceLog('canvas encode fallback', {
        ...logContext,
        format: 'png',
        reason: err.message,
      });
    }
  }
  const started = Date.now();
  const buffer = canvas.toBuffer('image/png');
  performanceLog('canvas encoded', {
    ...logContext,
    format: 'png',
    bytes: buffer.length,
    durationMs: Date.now() - started,
  });
  return buffer;
}

module.exports = { encodeOpaqueCanvas, fastOpaqueEncodeEnabled };
